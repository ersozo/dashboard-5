// DOM Elements
const currentTimeDisplay = document.getElementById('current-time');
const loadingIndicator = document.getElementById('loading-indicator');
const hourlyDataContainer = document.getElementById('hourly-data-container');
const selectedUnitsDisplay = document.getElementById('selected-units-display');
const timeRangeDisplay = document.getElementById('time-range-display');

// Parse URL parameters
let selectedUnits = [];
let startTime = null;
let endTime = null;
let timePresetValue = '';
let workingModeValue = 'mode1'; // Default to mode1
// Store WebSocket connections for each unit
let unitSockets = {};
// Store unit data containers to update them
let unitContainers = {};
// Create a last update display
let lastUpdateDisplay = null;
// Flag to prevent old WebSocket data processing during shift changes
let isShiftChangeInProgress = false;

// Background tab handling variables
let isTabVisible = true;
let lastVisibilityChange = Date.now();
let visibilityCheckInterval = null;
let clockUpdateInterval = null;
let shiftCheckInterval = null;

// CRITICAL FIX: Global status monitoring system to prevent permanent freezing
let statusMonitorInterval = null;
let lastSuccessfulUpdate = Date.now();

// Working mode configurations (same as in app.js)
const workingModes = {
    mode1: {
        name: 'Mod 1 (Mevcut)',
        shifts: [
            { id: 'shift1', name: '08:00 - 16:00', start: 8, end: 16, crossesMidnight: false },
            { id: 'shift2', name: '16:00 - 24:00', start: 16, end: 24, crossesMidnight: false },
            { id: 'shift3', name: '00:00 - 08:00', start: 0, end: 8, crossesMidnight: false }
        ]
    },
    mode2: {
        name: 'Mod 2',
        shifts: [
            { id: 'shift1', name: '08:00 - 18:00', start: 8, end: 18, crossesMidnight: false },
            { id: 'shift2', name: '20:00 - 08:00', start: 20, end: 8, crossesMidnight: true }
        ]
    },
    mode3: {
        name: 'Mod 3',
        shifts: [
            { id: 'shift1', name: '08:00 - 20:00', start: 8, end: 20, crossesMidnight: false },
            { id: 'shift2', name: '20:00 - 08:00', start: 20, end: 8, crossesMidnight: true }
        ]
    }
};

// Function to handle visibility changes for background tab optimization
function handleVisibilityChange() {
    const wasVisible = isTabVisible;
    isTabVisible = !document.hidden;
    lastVisibilityChange = Date.now();

    console.log(`[VISIBILITY] Tab visibility changed: ${wasVisible ? 'visible' : 'hidden'} → ${isTabVisible ? 'visible' : 'hidden'}`);

    if (!wasVisible && isTabVisible) {
        // Tab became visible - force immediate refresh
        console.log('[VISIBILITY] Tab became visible - forcing immediate data refresh');

        // For live data views, update endTime to current time to maintain live status
    const now = new Date();
        const originalTimeDifference = now.getTime() - endTime.getTime();
        const fiveMinutesInMs = 5 * 60 * 1000;
        const wasOriginallyLive = originalTimeDifference <= fiveMinutesInMs;

        console.log(`[VISIBILITY] Original endTime: ${endTime.toISOString()}`);
        console.log(`[VISIBILITY] Current time: ${now.toISOString()}`);
        console.log(`[VISIBILITY] Time difference: ${Math.round(originalTimeDifference / 1000)}s`);
        console.log(`[VISIBILITY] Was originally live: ${wasOriginallyLive}`);

        // IMPROVED LOGIC: Check if this is a shift-based live data view
        // If timePresetValue is set (shift1, shift2, shift3), this should be treated as live data
        const isShiftBasedView = timePresetValue && (timePresetValue.startsWith('shift'));
        const shouldUpdateEndTime = wasOriginallyLive || isShiftBasedView;

        console.log(`[VISIBILITY] Is shift-based view: ${isShiftBasedView}`);
        console.log(`[VISIBILITY] Should update endTime: ${shouldUpdateEndTime}`);

        if (shouldUpdateEndTime) {
            // This was originally a live data view or is a shift-based view, so update endTime to maintain live status
            console.log('[VISIBILITY] Updating endTime to maintain live data status');
            const oldEndTime = endTime.toISOString();
            endTime = now;
            console.log(`[VISIBILITY] EndTime updated: ${oldEndTime} → ${endTime.toISOString()}`);

            // Force immediate UI update to show live status
            updateCurrentTime();
            updateLastUpdateTime();

            // Also check if we need to update to a new shift for live data
            if (checkForNewTimePeriod()) {
                console.log('[VISIBILITY] Shift change detected on tab focus');
                updateTimePeriod();
                return; // updateTimePeriod will handle the refresh
            }
        }

        // Force data refresh for all active WebSocket connections
        forceDataRefreshAllUnits();

        // Defer UI update to next frame to avoid blocking
        requestAnimationFrame(() => {
            updateCurrentTime();
            updateLastUpdateTime();
            console.log('[VISIBILITY] Forced UI update after data refresh');
        });
    }
}

// Function to force data refresh for all units
function forceDataRefreshAllUnits() {
    console.log('[VISIBILITY] forceDataRefreshAllUnits called');
    console.log('[VISIBILITY] Current endTime:', endTime.toISOString());
    console.log('[VISIBILITY] Current time:', new Date().toISOString());

    // For shift-based live views, always update endTime to maintain live status
    const isShiftBasedView = timePresetValue && (timePresetValue.startsWith('shift'));
    if (isShiftBasedView) {
        const now = new Date();
        console.log('[VISIBILITY] Updating endTime for shift-based live view');
        const oldEndTime = endTime.toISOString();
        endTime = now;
        console.log(`[VISIBILITY] EndTime updated in forceRefresh: ${oldEndTime} → ${endTime.toISOString()}`);
    }

    let refreshCount = 0;
    for (const unitName in unitSockets) {
        const socket = unitSockets[unitName];
        if (socket && socket.readyState === WebSocket.OPEN && !socket._isInvalid) {
            console.log(`[VISIBILITY] Forcing data refresh for unit: ${unitName}`);

            // Check if this is historical data using centralized function
            const isHistorical = isDataHistorical();

            console.log(`[VISIBILITY] Unit ${unitName} - isHistorical: ${isHistorical}`);

            if (!isHistorical) {
                const requestEndTime = new Date();
                const params = {
                    start_time: startTime.toISOString(),
                    end_time: requestEndTime.toISOString(),
                    working_mode: workingModeValue || 'mode1'
                };

                console.log(`[VISIBILITY] Sending refresh request for ${unitName}:`, {
                    start: params.start_time,
                    end: params.end_time,
                    working_mode: params.working_mode
                });

                socket.send(JSON.stringify(params));
                refreshCount++;
            } else {
                console.log(`[VISIBILITY] Skipping refresh for ${unitName} - data is historical`);
            }
        } else {
            console.log(`[VISIBILITY] Skipping ${unitName} - socket not ready (state: ${socket ? socket.readyState : 'null'})`);
        }
    }
    
    // Show update indicator only if we actually sent refresh requests
    if (refreshCount > 0) {
        showUpdatingIndicator();
        // Auto-hide after longer delay for batch operations (hourly data takes more time)
        setTimeout(() => {
            document.getElementById('loading-indicator').classList.add('hidden');
        }, 3000);
    }
}

// Optimized interval management for background tabs
function startOptimizedIntervals() {
    // Clear any existing intervals
    stopOptimizedIntervals();

    // OPTIMIZED: Use fastest intervals for live hourly data (most critical)
    // Hourly view needs the most responsive updates for real-time production monitoring
    const CLOCK_UPDATE_INTERVAL = 1000; // 1 second - fastest for live time display
    const SHIFT_CHECK_INTERVAL = 10000; // 10 seconds - fastest shift detection for hourly view
    const VISIBILITY_CHECK_INTERVAL = 5000; // 5 seconds - fastest visibility checks for responsiveness

    // Clock update interval (optimized frequency)
    clockUpdateInterval = setInterval(updateCurrentTime, CLOCK_UPDATE_INTERVAL);

    // Shift change check with consistent frequency
    shiftCheckInterval = setInterval(() => {
        if (checkForNewTimePeriod()) {
            console.log('Hourly view: Shift change detected, updating time period...');
            updateTimePeriod();
        }
    }, SHIFT_CHECK_INTERVAL);

    // IMPROVED: Optimized visibility check that doesn't restart intervals
    visibilityCheckInterval = setInterval(() => {
        const currentVisible = !document.hidden;
        if (currentVisible !== isTabVisible) {
            // Visibility state changed, handle it directly
            console.log('[VISIBILITY] Detected visibility change via monitoring');
            isTabVisible = currentVisible;
            lastVisibilityChange = Date.now();
            
            // Force refresh when tab becomes visible instead of restarting intervals
            if (isTabVisible) {
                console.log('[VISIBILITY] Tab became visible - forcing immediate refresh');
                forceDataRefreshAllUnits();
            }
        }
    }, VISIBILITY_CHECK_INTERVAL);

    console.log(`[INTERVALS] Started optimized intervals - clock: ${CLOCK_UPDATE_INTERVAL}ms, shift: ${SHIFT_CHECK_INTERVAL}ms, visibility: ${VISIBILITY_CHECK_INTERVAL}ms - tab visible: ${isTabVisible}`);
}

function stopOptimizedIntervals() {
    if (clockUpdateInterval) {
        clearInterval(clockUpdateInterval);
        clockUpdateInterval = null;
    }
    if (shiftCheckInterval) {
        clearInterval(shiftCheckInterval);
        shiftCheckInterval = null;
    }
    if (visibilityCheckInterval) {
        clearInterval(visibilityCheckInterval);
        visibilityCheckInterval = null;
    }
}

// Function to check if we need to update to a new time period
function checkForNewTimePeriod() {
    if (!timePresetValue || !startTime || !endTime || !workingModeValue) return false;

    const now = new Date();
    const currentHour = now.getHours();

    // Simple, direct shift boundary detection for Mode 1
    if (workingModeValue === 'mode1') {
        // Shift 1 (08:00-16:00) → Shift 2 (16:00-24:00)
        if (timePresetValue === 'shift1' && currentHour >= 16) {
            console.log('[SHIFT CHANGE] 16:00 boundary detected - Shift 1 → Shift 2');
            return true;
        }

        // Shift 2 (16:00-24:00) → Shift 3 (00:00-08:00)
        if (timePresetValue === 'shift2' && (currentHour >= 24 || currentHour === 0)) {
            console.log('[SHIFT CHANGE] 00:00 boundary detected - Shift 2 → Shift 3');
            return true;
        }

        // Shift 3 (00:00-08:00) → Shift 1 (08:00-16:00)
        if (timePresetValue === 'shift3' && currentHour >= 8) {
            console.log('[SHIFT CHANGE] 08:00 boundary detected - Shift 3 → Shift 1');
            return true;
        }
    }

    // Mode 2 shift boundaries
    if (workingModeValue === 'mode2') {
        // Shift 1 (08:00-18:00) → Shift 2 (20:00-08:00)
        if (timePresetValue === 'shift1' && currentHour >= 18) {
            console.log('[SHIFT CHANGE] 18:00 boundary detected - Mode 2 Shift 1 → Shift 2');
            return true;
        }

        // Shift 2 (20:00-08:00) → Shift 1 (08:00-18:00)
        if (timePresetValue === 'shift2' && currentHour >= 8 && currentHour < 18) {
            console.log('[SHIFT CHANGE] 08:00 boundary detected - Mode 2 Shift 2 → Shift 1');
            return true;
        }
    }

    // Mode 3 shift boundaries
    if (workingModeValue === 'mode3') {
        // Shift 1 (08:00-20:00) → Shift 2 (20:00-08:00)
        if (timePresetValue === 'shift1' && currentHour >= 20) {
            console.log('[SHIFT CHANGE] 20:00 boundary detected - Mode 3 Shift 1 → Shift 2');
            return true;
        }

        // Shift 2 (20:00-08:00) → Shift 1 (08:00-20:00)
        if (timePresetValue === 'shift2' && currentHour >= 8 && currentHour < 20) {
            console.log('[SHIFT CHANGE] 08:00 boundary detected - Mode 3 Shift 2 → Shift 1');
            return true;
        }
    }

    return false;
}

// Function to update time period
function updateTimePeriod() {
    const now = new Date();
    const currentHour = now.getHours();

    console.log('[SHIFT CHANGE] Executing shift change automation...');

    // Set flag to prevent old WebSocket data from being processed
    isShiftChangeInProgress = true;

    // Determine new shift based on current hour and mode
    let newShift = '';
    let newStartHour = 0;

    if (workingModeValue === 'mode1') {
        if (currentHour >= 16 && currentHour < 24) {
            newShift = 'shift2';
            newStartHour = 16;
        } else if (currentHour >= 0 && currentHour < 8) {
            newShift = 'shift3';
            newStartHour = 0;
        } else if (currentHour >= 8 && currentHour < 16) {
            newShift = 'shift1';
            newStartHour = 8;
        }
    } else if (workingModeValue === 'mode2') {
        if (currentHour >= 8 && currentHour < 18) {
            newShift = 'shift1';
            newStartHour = 8;
        } else {
            newShift = 'shift2';
            newStartHour = 20;
        }
    } else if (workingModeValue === 'mode3') {
        if (currentHour >= 8 && currentHour < 20) {
            newShift = 'shift1';
            newStartHour = 8;
        } else {
            newShift = 'shift2';
            newStartHour = 20;
        }
    }

    // Update global variables
    timePresetValue = newShift;
    startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), newStartHour, 0, 0, 0);
    endTime = now;

    console.log(`[SHIFT CHANGE] Updated to ${newShift}:`);
    console.log(`  timePresetValue: ${timePresetValue}`);
    console.log(`  startTime: ${startTime.toISOString()}`);
    console.log(`  endTime: ${endTime.toISOString()}`);

    // Close existing WebSocket connections and mark them as invalid
    console.log('[SHIFT CHANGE] Closing existing WebSocket connections...');
    for (const unitName in unitSockets) {
        if (unitSockets[unitName]) {
            // Mark the connection as invalid before closing
            unitSockets[unitName]._isInvalid = true;
            unitSockets[unitName].close();
            delete unitSockets[unitName];
        }
    }

    // Clear containers
    unitContainers = {};

    // Clear UI containers
    if (typeof hourlyDataContainer !== 'undefined' && hourlyDataContainer) {
        hourlyDataContainer.innerHTML = '';
    }
    if (typeof unitsContainer !== 'undefined' && unitsContainer) {
        unitsContainer.innerHTML = '';
    }
    if (typeof summaryContainer !== 'undefined' && summaryContainer) {
        summaryContainer.classList.add('hidden');
    }

    // Reload data with new shift parameters
    console.log('[SHIFT CHANGE] Reloading data for new shift...');
    loadHourlyData();

    // Reset the shift change flag after a short delay to allow new connections to establish
    setTimeout(() => {
        isShiftChangeInProgress = false;
        console.log('[SHIFT CHANGE] Shift change process completed');
    }, 2000);

    // CRITICAL SAFETY: Force reset shift change flag after maximum timeout to prevent permanent blocking
    setTimeout(() => {
        if (isShiftChangeInProgress) {
            console.warn('[SHIFT CHANGE SAFETY] Force clearing stuck isShiftChangeInProgress flag after 10 seconds');
            isShiftChangeInProgress = false;
        }
    }, 10000);

    console.log(`[SHIFT CHANGE] ✅ COMPLETE - Now on ${newShift}`);
}

document.addEventListener('DOMContentLoaded', () => {
    // Set up visibility change detection for background tab optimization
    isTabVisible = !document.hidden;
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Update current time immediately and start optimized intervals
    updateCurrentTime();
    startOptimizedIntervals();

    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);

    // Get units
    selectedUnits = params.getAll('units');

    // Get time parameters
    const startParam = params.get('start');
    const endParam = params.get('end');
    timePresetValue = params.get('preset') || '';
    workingModeValue = params.get('workingMode') || 'mode1'; // Default to mode1 if not specified

    console.log('=== HOURLY VIEW URL PARAMETER DEBUG ===');
    console.log('Full URL:', window.location.href);
    console.log('Search params:', window.location.search);
    console.log('Start param (raw):', startParam);
    console.log('End param (raw):', endParam);
    console.log('Selected units:', selectedUnits);
    console.log('Time preset value:', timePresetValue);
    console.log('Working mode value:', workingModeValue);

    if (startParam) {
        startTime = new Date(startParam);
        console.log('Parsed start time:', startTime);
        console.log('Start time ISO:', startTime.toISOString());
        console.log('Start time is valid?:', !isNaN(startTime.getTime()));
    }

    if (endParam) {
        endTime = new Date(endParam);
        console.log('Parsed end time:', endTime);
        console.log('End time ISO:', endTime.toISOString());
        console.log('End time is valid?:', !isNaN(endTime.getTime()));
    }

    console.log('=== END HOURLY URL PARSING DEBUG ===');

    // If no valid parameters, redirect back to home
    if (selectedUnits.length === 0 || !startTime || !endTime) {
        alert('Missing required parameters. Redirecting to dashboard.');
        window.location.href = '/';
        return;
    }

    // Create last update display
    createLastUpdateDisplay();

    // Load data for each unit
    loadHourlyData();

    // Add cleanup on page unload
    window.addEventListener('beforeunload', () => {
        stopStatusMonitoring();
        stopOptimizedIntervals();
        
        // Close all WebSocket connections
        for (const unitName in unitSockets) {
            if (unitSockets[unitName] && unitSockets[unitName].readyState === WebSocket.OPEN) {
                unitSockets[unitName].close();
            }
        }
    });
});

// Create last update display
function createLastUpdateDisplay() {
    lastUpdateDisplay = document.createElement('div');
    lastUpdateDisplay.className = 'fixed top-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg opacity-80 z-50';
    lastUpdateDisplay.innerHTML = 'Veri bekleniyor...';
    document.body.appendChild(lastUpdateDisplay);
}

// Update the last update time display
function updateLastUpdateTime() {
    if (lastUpdateDisplay) {
        // CRITICAL FIX: Clear the updating timeout when successful update occurs
        if (window.updatingTimeout) {
            clearTimeout(window.updatingTimeout);
            window.updatingTimeout = null;
        }
        
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        const displayText = `🟢 Canlı Veri: ${hours}:${minutes}:${seconds}`;

        // Flash effect to indicate update for live data
            lastUpdateDisplay.classList.add('bg-green-600');
            setTimeout(() => {
                lastUpdateDisplay.classList.remove('bg-green-600');
                lastUpdateDisplay.classList.add('bg-gray-800');
            }, 1000);

        lastUpdateDisplay.innerHTML = displayText;
    }
}

// Show update in progress indicator
function showUpdatingIndicator() {
    if (lastUpdateDisplay) {
            lastUpdateDisplay.innerHTML = 'Güncelleniyor...';
            lastUpdateDisplay.classList.remove('bg-gray-800');
            lastUpdateDisplay.classList.add('bg-blue-600');
        
        // CRITICAL FIX: Add timeout to prevent permanent "Güncelleniyor..." status
        // Clear any existing timeout
        if (window.updatingTimeout) {
            clearTimeout(window.updatingTimeout);
        }
        
        // Set timeout to revert status if no update received
        window.updatingTimeout = setTimeout(() => {
            if (lastUpdateDisplay && lastUpdateDisplay.innerHTML === 'Güncelleniyor...') {
                console.warn('[STATUS FIX] Updating indicator timed out - reverting to last update time');
                updateLastUpdateTime();
            }
        }, 15000); // 15 seconds timeout for updating status
    }
}

// Update current time display
function updateCurrentTime() {
    const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        currentTimeDisplay.textContent = `${hours}:${minutes}`;
        currentTimeDisplay.style.fontSize = ''; // Reset to default size
}

// Format date for display
function formatDateForDisplay(date) {
    if (!date) return '';

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${day}.${month}.${year} ${hours}:${minutes}`;
}

// Format time for hourly display (HH:MM)
function formatTimeOnly(date) {
    if (!date) return '';

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${hours}:${minutes}`;
}

// Load hourly data for all units
function loadHourlyData() {
    // Show loading indicator
    loadingIndicator.classList.remove('hidden');

    // Clear hourly data container
    hourlyDataContainer.innerHTML = '';

    // Ensure any existing WebSocket connections are closed before creating new ones
    for (const unitName in unitSockets) {
        if (unitSockets[unitName] && unitSockets[unitName].readyState === WebSocket.OPEN) {
            console.log(`Closing existing WebSocket connection for "${unitName}" before reload`);
            unitSockets[unitName].close();
        }
    }

    // Clear the sockets object and unit containers
    unitSockets = {};
    unitContainers = {};

    // Set the grid layout based on number of units
    if (selectedUnits.length === 1) {
        // One unit - single column layout
        hourlyDataContainer.className = 'grid grid-cols-1 gap-4 w-full';
    } else {
        // Multiple units - two column layout
        hourlyDataContainer.className = 'grid grid-cols-1 md:grid-cols-2 gap-4 w-full';
    }

    // Create connections for each selected unit with staggering to reduce server load
    let completedRequests = 0;

    selectedUnits.forEach((unit, index) => {
        // Stagger connections by 2 seconds each to prevent server overload
        const connectionDelay = index * 2000;
        
        setTimeout(() => {
            console.log(`[CONNECTION STAGGER] Starting connection for ${unit} (delay: ${connectionDelay}ms)`);
            
            // Connect to WebSocket for hourly data
            connectHourlyWebSocket(unit, startTime, endTime, (data) => {
                // Process data for this unit
                createOrUpdateHourlyDataDisplay(unit, data);

                // Track completed requests for initial loading
                completedRequests++;

                // When all initial requests are done, hide loading
                if (completedRequests === selectedUnits.length) {
                    // Hide loading indicator
                    loadingIndicator.classList.add('hidden');
                    // Update the last update time
                    updateLastUpdateTime();
                    // Start status monitoring
                    startStatusMonitoring();
                    // PRODUCTION FIX: Start aggressive auto-recovery system
                    window.startProductionAutoRecovery();
                    console.log('🚀 PRODUCTION: Auto-recovery system activated');
                }
            });
        }, connectionDelay);
    });
}

// Create or update hourly data display for a unit
function createOrUpdateHourlyDataDisplay(unitName, data) {
    // PRODUCTION FIX: Log shift changes but NEVER block UI updates - data freshness is critical
    if (isShiftChangeInProgress) {
        console.log(`[SHIFT CHANGE] UI update proceeding during shift change for "${unitName}" (NEVER BLOCK)`);
    }

    if (!data) {
        console.error(`Invalid data received for "${unitName}"`);
        return;
    }

    if (!data.hourly_data) {
        console.error(`No hourly data received for "${unitName}"`);
        return;
    }

    if (!Array.isArray(data.hourly_data)) {
        console.error(`hourly_data is not an array for "${unitName}"`);
        return;
    }

    console.log(`Processing hourly display for "${unitName}" with ${data.hourly_data.length} records`);
    console.log(`Summary totals: success=${data.total_success}, fail=${data.total_fail}, total=${data.total_qty}`);
    
    // DEBUG: Log all hourly records received
    console.log(`[FRONTEND DEBUG] Raw hourly_data for ${unitName}:`, data.hourly_data);
    data.hourly_data.forEach((hour, i) => {
        console.log(`[FRONTEND DEBUG] Hour ${i}: ${hour.hour_start} → ${hour.hour_end} | Success: ${hour.success_qty} | Fail: ${hour.fail_qty}`);
    });

    // Check if container for this unit already exists
    if (unitContainers[unitName]) {
        // Update existing container
        updateHourlyDataDisplay(unitName, data);
        return;
    }

    // Create unit section
    const unitSection = document.createElement('div');
    unitSection.id = `unit-section-${unitName.replace(/\s+/g, '-')}`;
    unitSection.className = 'bg-white rounded-lg shadow p-2 w-full';

    // Create unit summary
    const summarySection = document.createElement('div');
    summarySection.id = `summary-section-${unitName.replace(/\s+/g, '-')}`;
    summarySection.className = 'bg-gray-50 rounded-lg p-2 w-full';

    // Extract unit short name (e.g., "1A" from "Final 1A")
    const unitShortName = unitName.includes(' ') ? unitName.split(' ').pop() : unitName;

    // Get the summary data
    const totalSuccessQty = data.total_success || 0;

    // Create a table for the summary
    const summaryTable = document.createElement('table');
    summaryTable.className = 'w-full';

    // Create table body
    const summaryTableBody = document.createElement('tbody');

    // Create a single row with two columns
    const row = document.createElement('tr');

    // Column 1: UnitName Üretim
    const col1 = document.createElement('td');
    col1.className = 'p-0';
    col1.style.width = '50%';

    const col1Header = document.createElement('div');
    col1Header.className = 'text-white text-7xl font-bold text-center p-2';
    col1Header.style.backgroundColor = '#7F1D1D'; // bg-red-900
    col1Header.textContent = `${unitShortName} ÜRETİM`;

    const col1Value = document.createElement('div');
    col1Value.id = `production-value-${unitName.replace(/\s+/g, '-')}`;
    col1Value.className = 'text-9xl font-bold text-center p-2';
    col1Value.style.backgroundColor = '#FEF08A'; // bg-yellow-200
    col1Value.textContent = totalSuccessQty.toLocaleString();

    col1.appendChild(col1Header);
    col1.appendChild(col1Value);

    // Column 2: Theoretical Production instead of Performance
    const col2 = document.createElement('td');
    col2.className = 'p-0';
    col2.style.width = '50%';

    const col2Header = document.createElement('div');
    col2Header.className = 'text-white text-7xl font-bold text-center p-2';
    col2Header.style.backgroundColor = '#7F1D1D'; // bg-red-900
    col2Header.textContent = 'HEDEF';

    const col2Value = document.createElement('div');
    col2Value.id = `theoretical-value-${unitName.replace(/\s+/g, '-')}`;
    col2Value.className = 'text-9xl font-bold text-center p-2';
    col2Value.style.backgroundColor = '#BBF7D0'; // bg-green-200

    // Calculate Theoretical Production Quantity from data summary
    let theoreticalValue = '-';
    if (data.total_theoretical_qty !== null && data.total_theoretical_qty !== undefined && data.total_theoretical_qty > 0) {
        theoreticalValue = Math.round(data.total_theoretical_qty).toLocaleString();
    }
    col2Value.textContent = theoreticalValue;

    col2.appendChild(col2Header);
    col2.appendChild(col2Value);

    // Add columns to row
    row.appendChild(col1);
    row.appendChild(col2);

    // Add row to table body
    summaryTableBody.appendChild(row);

    // Add table body to table
    summaryTable.appendChild(summaryTableBody);

    // Add table to summary section
    summarySection.appendChild(summaryTable);

    // Add summary section to unit section
    unitSection.appendChild(summarySection);

    // Create table container
    const tableContainer = document.createElement('div');
    tableContainer.id = `table-container-${unitName.replace(/\s+/g, '-')}`;
    tableContainer.className = 'w-full';

    // Create table
    const table = document.createElement('table');
    table.className = 'w-full divide-y divide-gray-200';

    // Create table header
    const tableHead = document.createElement('thead');
    tableHead.className = 'bg-gray-300';

    const headerRow = document.createElement('tr');

    const headers = [
        'Saat', 'Üretim', 'Tamir', 'Hedef'
    ];

    headers.forEach(headerText => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.className = 'px-2 py-2 text-center font-bold text-black text-5xl tracking-wider';
        th.textContent = headerText;
        headerRow.appendChild(th);
    });

    tableHead.appendChild(headerRow);
    table.appendChild(tableHead);

    // Create table body
    const tableBody = document.createElement('tbody');
    tableBody.id = `table-body-${unitName.replace(/\s+/g, '-')}`;
    tableBody.className = 'bg-white divide-y divide-gray-200';

    // Update table body with hourly data
    updateTableBody(tableBody, data.hourly_data);

    table.appendChild(tableBody);
    tableContainer.appendChild(table);
    unitSection.appendChild(tableContainer);

    // Add the unit section to the container
    hourlyDataContainer.appendChild(unitSection);

    // Store the section for future updates
    unitContainers[unitName] = {
        section: unitSection,
        productionValue: col1Value,
        theoreticalValue: col2Value,
        tableBody: tableBody,
        lastData: JSON.parse(JSON.stringify(data)) // Store initial data for comparison
    };

    console.log(`Created display for "${unitName}"`);
}

// Update an existing hourly data display for a unit
function updateHourlyDataDisplay(unitName, data) {
    // PRODUCTION FIX: Log shift changes but NEVER block UI updates - data freshness is critical
    if (isShiftChangeInProgress) {
        console.log(`[SHIFT CHANGE] UI update proceeding during shift change for "${unitName}" (NEVER BLOCK)`);
    }

    if (!unitContainers[unitName]) {
        console.error(`Cannot update display - container not found for "${unitName}"`);
        return;
    }

    if (!data || !data.hourly_data) {
        console.error(`Cannot update display - invalid data for "${unitName}"`);
        return;
    }

    const container = unitContainers[unitName];

    // Update summary values with total data (not hourly data)
    const totalSuccessQty = data.total_success || 0;
    container.productionValue.textContent = totalSuccessQty.toLocaleString();

    // Update Theoretical Production Quantity from data summary (not from hourly data)
    let theoreticalValue = '-';
    if (data.total_theoretical_qty !== null && data.total_theoretical_qty !== undefined && data.total_theoretical_qty > 0) {
        theoreticalValue = Math.round(data.total_theoretical_qty).toLocaleString();
    }
    container.theoreticalValue.textContent = theoreticalValue;

    // Update table body with the latest hourly data
    updateTableBody(container.tableBody, data.hourly_data);

    // Add a flash effect to the updated values
    container.productionValue.classList.add('flash-update');
    container.theoreticalValue.classList.add('flash-update');

    // Remove flash effect after animation
    setTimeout(() => {
        container.productionValue.classList.remove('flash-update');
        container.theoreticalValue.classList.remove('flash-update');
    }, 500);

    console.log(`Updated display for "${unitName}" complete`);
}

// Helper function to update table body with hourly data
function updateTableBody(tableBody, hourlyData) {
    console.log(`Updating table body with ${hourlyData?.length || 0} hourly records`);

    // Clear the table body
    tableBody.innerHTML = '';

    if (!hourlyData || hourlyData.length === 0) {
        // No data case
        const noDataRow = document.createElement('tr');
        const noDataCell = document.createElement('td');
        noDataCell.colSpan = 4; // Update colspan to match header count (was 6, now 4)
        noDataCell.className = 'px-2 py-2 text-center text-gray-500';
        noDataCell.textContent = 'Bu birim için veri bulunamadı';
        noDataRow.appendChild(noDataCell);
        tableBody.appendChild(noDataRow);
        return;
    }

    // Make a deep copy of hourly data to avoid modifying the original
    const hourDataCopy = JSON.parse(JSON.stringify(hourlyData));

    // Validate and sanitize each hour data object
    hourDataCopy.forEach(hour => {
        // Ensure required fields exist
        if (hour.hour_start === undefined) {
            console.warn('Hour missing hour_start - skipping', hour);
            return;
        }
        if (hour.hour_end === undefined) {
            console.warn('Hour missing hour_end - skipping', hour);
            return;
        }

        // Ensure quantity fields are valid numbers
        hour.success_qty = hour.success_qty !== undefined ? Number(hour.success_qty) : 0;
        hour.fail_qty = hour.fail_qty !== undefined ? Number(hour.fail_qty) : 0;
        hour.total_qty = hour.total_qty !== undefined ? Number(hour.total_qty) : 0;

        // Ensure metric fields are valid numbers or null
        hour.quality = hour.quality !== undefined && hour.quality !== null ? Number(hour.quality) : 0;

        // For performance and OEE, if they're null/None from Python, keep them as null in JS
        if (hour.performance === null) {
            hour.performance = null;
        } else if (hour.performance !== undefined) {
            hour.performance = Number(hour.performance);
        } else {
            hour.performance = null;
        }

        if (hour.oee === null) {
            hour.oee = null;
        } else if (hour.oee !== undefined) {
            hour.oee = Number(hour.oee);
        } else {
            hour.oee = null;
        }

        // Convert ISO strings to Date objects for proper comparison
        try {
            hour._startDate = new Date(hour.hour_start);
            hour._endDate = new Date(hour.hour_end);
        } catch (e) {
            console.error('Error converting dates for hour:', hour, e);
            hour._startDate = new Date();
            hour._endDate = new Date();
        }
    });

    // DEBUG: Log each hour before filtering
    console.log(`[FRONTEND DEBUG] Before filtering - ${hourDataCopy.length} hours:`);
    hourDataCopy.forEach((hour, i) => {
        console.log(`[FRONTEND DEBUG] Hour ${i}: start=${hour.hour_start} (${hour._startDate}) | end=${hour.hour_end} (${hour._endDate})`);
    });

    // Filter out invalid hours
    const validHours = hourDataCopy.filter(hour => {
        const isValid = hour._startDate instanceof Date && !isNaN(hour._startDate) &&
                       hour._endDate instanceof Date && !isNaN(hour._endDate);
        if (!isValid) {
            console.warn(`[FRONTEND DEBUG] Invalid hour filtered out:`, hour);
        }
        return isValid;
    });

    console.log(`[FRONTEND DEBUG] After filtering - ${validHours.length} valid hours`);

    if (validHours.length === 0) {
        console.warn('No valid hour records found after validation');
        const noDataRow = document.createElement('tr');
        const noDataCell = document.createElement('td');
        noDataCell.colSpan = 4; // Update colspan to match header count (was 6, now 4)
        noDataCell.className = 'px-2 py-2 text-center text-gray-500';
        noDataCell.textContent = 'Geçerli veri bulunamadı';
        noDataRow.appendChild(noDataCell);
        tableBody.appendChild(noDataRow);
        return;
    }

    // Sort hours in descending order (newest hour first)
    validHours.sort((a, b) => b._startDate - a._startDate);
    
    // DEBUG: Log final sorted hours
    console.log(`[FRONTEND DEBUG] Final sorted hours:`);
    validHours.forEach((hour, i) => {
        console.log(`[FRONTEND DEBUG] Sorted ${i}: ${hour.hour_start} → ${hour.hour_end} | Success: ${hour.success_qty}`);
    });

    // Get current time to highlight current hour
    const now = new Date();

    // Add rows for each hour
    validHours.forEach((hour, index) => {
        // Skip any hour with missing data
        if (hour.hour_start === undefined || hour.hour_end === undefined) {
            return;
        }

        const row = document.createElement('tr');
        row.id = `hour-row-${hour._startDate.getHours()}`;

        // Check if this is the current hour
        const isCurrent = hour._startDate <= now && now < hour._endDate;

        // Add alternating background colors, with special highlight for current hour
        if (isCurrent) {
            row.className = 'bg-blue-50'; // Highlight current hour
        } else {
            row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-200';
        }

        // Hour range
        const hourCell = document.createElement('td');
        hourCell.className = 'px-2 py-2 text-center font-bold text-black text-2xl';
        hourCell.textContent = `${formatTimeOnly(hour._startDate)} - ${formatTimeOnly(hour._endDate)}`;

        // Add a badge for current hour
        if (isCurrent) {
            const currentBadge = document.createElement('span');
            currentBadge.className = 'ml-1 px-1 bg-green-100 text-green-800 text-xs rounded-full';
            currentBadge.textContent = 'Aktif';
            hourCell.appendChild(currentBadge);
        }

        row.appendChild(hourCell);

        // Success quantity (Production)
        const successQty = hour.success_qty || 0;
        const successCell = document.createElement('td');
        successCell.className = 'px-2 py-2 text-center text-black font-bold text-7xl';
        successCell.id = `success-${hour._startDate.getHours()}`;
        successCell.textContent = successQty.toLocaleString();
        row.appendChild(successCell);

        // Fail quantity (Repair)
        const failQty = hour.fail_qty || 0;
        const failCell = document.createElement('td');
        failCell.className = 'px-2 py-2 text-center text-red-900 font-bold text-7xl ';
        failCell.id = `fail-${hour._startDate.getHours()}`;
        failCell.textContent = failQty.toLocaleString();
        row.appendChild(failCell);

        // Theoretical Production
        const theoreticalCell = document.createElement('td');
        theoreticalCell.className = 'px-2 py-2 text-center text-black font-bold text-7xl';
        theoreticalCell.id = `theoretical-${hour._startDate.getHours()}`;
        // Use theoretical_qty field instead of performance
        if (hour.theoretical_qty === null || hour.theoretical_qty === undefined || hour.theoretical_qty === 0) {
            theoreticalCell.textContent = '-';
        } else {
            theoreticalCell.textContent = Math.round(hour.theoretical_qty).toLocaleString();
        }
        row.appendChild(theoreticalCell);

        tableBody.appendChild(row);
    });
}

// Connect to WebSocket for hourly data and handle response
function connectHourlyWebSocket(unitName, startTime, endTime, callback) {
    // Determine WebSocket URL
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/hourly/${encodeURIComponent(unitName)}`;

    console.log(`Connecting to hourly WebSocket for "${unitName}" at ${wsUrl}`);

    // Create a new WebSocket for this unit
    const unitSocket = new WebSocket(wsUrl);

    // Store the socket for cleanup
    unitSockets[unitName] = unitSocket;

    let reconnectAttempts = 0;
    const maxReconnectAttempts = 8; // Reasonable limit for robust reconnection
    let updateInterval = null;
    let hasReceivedInitialData = false;
    let lastRequestTime = 0;
    
    // Pre-calculate reusable values to reduce overhead
    const workingMode = workingModeValue || 'mode1';
    const startTimeISO = startTime.toISOString();

    // Set a timeout to ensure we get a callback even if WebSocket fails to connect
    const connectionTimeout = setTimeout(() => {
        if (!hasReceivedInitialData) {
            console.warn(`Connection timeout for hourly data "${unitName}". Completing with empty data.`);
            hasReceivedInitialData = true;
            callback(null);
        }
    }, 15000); // 15 second timeout for hourly data (increased for heavy data processing)

    function sendDataRequest() {
        // PRODUCTION FIX: Log shift changes but NEVER block data requests - data freshness is critical
        if (isShiftChangeInProgress) {
            console.log(`[SHIFT CHANGE] Data request proceeding during shift change for "${unitName}" (NEVER BLOCK)`);
        }

        if (unitSocket.readyState === WebSocket.OPEN) {
            const now = Date.now();
            
            // Throttle requests to prevent excessive calls (minimum 8 seconds between requests for hourly data - most aggressive)
            if (now - lastRequestTime < 8000) {
                console.log(`[HOURLY THROTTLE] Skipping request for ${unitName} - too soon (${now - lastRequestTime}ms ago)`);
                return;
            }
            
            lastRequestTime = now;
                showUpdatingIndicator();

            // CRITICAL FIX: For shift-based views, always use current time to get latest hour data
            const currentTime = new Date(now);
            const isShiftBasedView = timePresetValue && timePresetValue.startsWith('shift');
            
            let requestEndTime;
            if (isShiftBasedView) {
                // For shift-based views, always use current time and update global endTime
                requestEndTime = currentTime;
                const oldEndTime = endTime.toISOString();
                endTime = currentTime; // Update global endTime for shift-based live data
                console.log(`[HOURLY LIVE] Shift-based view detected - extending endTime from ${oldEndTime} to ${endTime.toISOString()}`);
            } else {
                // For non-shift views, use current time for live data requests
                requestEndTime = currentTime;
                console.log(`[HOURLY LIVE] Using current time for live data request: ${requestEndTime.toISOString()}`);
            }

            // Send parameters to request new data - ALWAYS use fresh start_time for live data
            const params = {
                start_time: startTime.toISOString(), // Always use current start_time (not cached)
                end_time: requestEndTime.toISOString(),
                working_mode: workingMode // Reuse pre-calculated value
            };

            console.log(`[HOURLY REQUEST] ${unitName}: ${isShiftBasedView ? 'Shift-based live' : 'Live'} data request`);
            console.log(`[HOURLY REQUEST] Time range: ${params.start_time} → ${params.end_time}`);
            console.log(`[HOURLY REQUEST] Local current time: ${new Date().toISOString()}`);
            console.log(`[HOURLY REQUEST] Global startTime: ${startTime.toISOString()}`);
            console.log(`[HOURLY REQUEST] Global endTime: ${endTime.toISOString()}`);
            console.log(`[HOURLY REQUEST] Working mode: ${workingMode}`);

            try {
            unitSocket.send(JSON.stringify(params));
                
                // CRITICAL FIX: Set a response timeout to detect silent failures
                if (unitSocket.responseTimeout) {
                    clearTimeout(unitSocket.responseTimeout);
                }
                
                unitSocket.responseTimeout = setTimeout(() => {
                    console.warn(`[STATUS FIX] No response received for ${unitName} within 30 seconds - checking connection`);
                    
                    // Check if socket is still open but not responding
                    if (unitSocket.readyState === WebSocket.OPEN) {
                        console.warn(`[STATUS FIX] Socket appears open but unresponsive for ${unitName} - forcing reconnection`);
                        unitSocket.close(1000, 'Response timeout');
                    }
                }, 30000); // 30 second response timeout (increased for heavy hourly data processing)
            } catch (error) {
                console.error(`[STATUS FIX] Failed to send WebSocket message for ${unitName}:`, error);
                // Force connection reset on send error
                if (unitSocket.readyState === WebSocket.OPEN) {
                    unitSocket.close(1006, 'Send error');
                }
            }
        } else {
            console.warn(`Cannot send hourly update request - socket not open for "${unitName}", readyState: ${unitSocket.readyState}`);
            // Clear interval if socket is not open
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }

            // If we haven't received initial data and socket is closed, trigger callback with empty data
            if (!hasReceivedInitialData) {
                console.warn(`Socket closed before receiving initial hourly data for "${unitName}". Completing with empty data.`);
                hasReceivedInitialData = true;
                clearTimeout(connectionTimeout);
                callback(null);
            }
        }
    }

    unitSocket.onopen = () => {
        console.log(`Hourly WebSocket connection established for "${unitName}"`);
        reconnectAttempts = 0; // Reset reconnect attempts on successful connection

        // Send initial parameters once connected
        sendDataRequest();

        // OPTIMIZED INTERVAL SYSTEM - FASTEST for live hourly data (most critical)
        const UPDATE_INTERVAL = 12000; // 12 seconds - fastest for hourly view (most critical real-time data)
        
        updateInterval = setInterval(() => {
            // SIMPLIFIED: Only send requests if connection is open and healthy
            if (unitSocket.readyState === WebSocket.OPEN) {
                // For background tabs, skip fewer requests (hourly data is most critical)
                const shouldSkipRequest = !isTabVisible && Math.random() < 0.15; // Skip only 15% of requests when hidden (less than other views)
                
                if (!shouldSkipRequest) {
                    sendDataRequest();
                } else {
                    console.log(`[HOURLY OPTIMIZATION] Skipping background request for ${unitName}`);
                }
            } else {
                console.warn(`[HOURLY ERROR] Connection lost for ${unitName} (state: ${unitSocket.readyState}), clearing interval`);
                clearInterval(updateInterval);
                updateInterval = null;
                // Note: Global recovery system will handle reconnection
            }
        }, UPDATE_INTERVAL);

        // CRITICAL FIX: Add heartbeat mechanism to detect dead connections
        const HEARTBEAT_INTERVAL = 60000; // 60 seconds
        let lastHeartbeat = Date.now();
        
        const heartbeatInterval = setInterval(() => {
            const now = Date.now();
            const timeSinceLastMessage = now - lastHeartbeat;
            
            // If no message received for 2 minutes, force reconnection
            if (timeSinceLastMessage > 120000) {
                console.warn(`[STATUS FIX] No heartbeat from ${unitName} for ${Math.round(timeSinceLastMessage/1000)}s - forcing reconnection`);
                clearInterval(heartbeatInterval);
                if (unitSocket.readyState === WebSocket.OPEN) {
                    unitSocket.close(1000, 'Heartbeat timeout');
                }
            }
        }, HEARTBEAT_INTERVAL);
        
        // Store heartbeat interval for cleanup
        unitSocket.heartbeatInterval = heartbeatInterval;

        console.log(`[HOURLY WEBSOCKET] Connected to ${unitName} with optimized ${UPDATE_INTERVAL}ms interval`);
    };

    unitSocket.onmessage = (event) => {
        try {
            // CRITICAL FIX: Clear response timeout when message is received
            if (unitSocket.responseTimeout) {
                clearTimeout(unitSocket.responseTimeout);
                unitSocket.responseTimeout = null;
            }
            
            // Update last heartbeat time for connection health monitoring
            if (unitSocket.heartbeatInterval) {
                lastHeartbeat = Date.now();
            }

            // PRODUCTION FIX: Log shift changes but NEVER block data processing - data freshness is critical
            if (isShiftChangeInProgress) {
                console.log(`[SHIFT CHANGE] Data processing proceeding during shift change for "${unitName}" (NEVER BLOCK)`);
            }

            console.log(`Received hourly data message for "${unitName}" (length: ${event.data.length})`);

            // Validate raw data first
            if (!event.data) {
                console.error(`Empty data received for "${unitName}"`);
                if (!hasReceivedInitialData) {
                    hasReceivedInitialData = true;
                    clearTimeout(connectionTimeout);
                    callback(null);
                }
                return;
            }

            // Try to parse the data
            const data = JSON.parse(event.data);

            // Check if response contains an error
            if (data.error) {
                console.error(`Error for hourly data "${unitName}":`, data.error);

                // Still count as completed for multi-unit processing
                if (!hasReceivedInitialData) {
                    hasReceivedInitialData = true;
                    clearTimeout(connectionTimeout);
                    callback(null);
                }
            } else {
                console.log(`Processed hourly data for "${unitName}": ${data.hourly_data ? data.hourly_data.length : 0} hour records`);

                // Detailed data validation and logging
                if (!data.hourly_data) {
                    console.error(`No hourly_data field in response for "${unitName}"`);
                } else if (!Array.isArray(data.hourly_data)) {
                    console.error(`hourly_data is not an array for "${unitName}"`);
                } else if (data.hourly_data.length === 0) {
                    console.warn(`Empty hourly_data array for "${unitName}"`);
                } else {
                    // Print summary of hourly data
                    console.log(`Hourly data summary for "${unitName}":`);
                    data.hourly_data.forEach(hour => {
                        const startTime = new Date(hour.hour_start);
                        const endTime = new Date(hour.hour_end);
                        const startDisplay = `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}`;
                        const endDisplay = `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`;
                        console.log(`${startDisplay}-${endDisplay}: Success=${hour.success_qty}, Fail=${hour.fail_qty}, Quality=${hour.quality !== null && hour.quality !== undefined ? (hour.quality * 100).toFixed(0) : 'N/A'}%`);
                    });

                    // Find current hour with proper timezone handling
                    const now = new Date();
                    console.log(`[CURRENT HOUR DEBUG] Current time: ${now.toISOString()} (${now.toString()})`);
                    
                    const currentHour = data.hourly_data.find(h => {
                        const hourStart = new Date(h.hour_start);
                        const hourEnd = new Date(h.hour_end);
                        
                        // Add 30-second tolerance to handle race conditions where current time 
                        // might be slightly after hour_end due to network/processing delays
                        const toleranceMs = 30 * 1000; // 30 seconds
                        const hourEndWithTolerance = new Date(hourEnd.getTime() + toleranceMs);
                        
                        console.log(`[CURRENT HOUR DEBUG] Checking hour: ${hourStart.toISOString()} - ${hourEnd.toISOString()} (tolerance: +30s)`);
                        console.log(`[CURRENT HOUR DEBUG] Comparison: ${hourStart.toISOString()} <= ${now.toISOString()} < ${hourEndWithTolerance.toISOString()}`);
                        const result = hourStart <= now && now < hourEndWithTolerance;
                        console.log(`[CURRENT HOUR DEBUG] Result: ${hourStart <= now} && ${now < hourEndWithTolerance} = ${result}`);
                        
                        return result;
                    });

                    if (currentHour) {
                        const currentStartTime = new Date(currentHour.hour_start);
                        const currentEndTime = new Date(currentHour.hour_end);
                        const currentStartDisplay = `${currentStartTime.getHours().toString().padStart(2, '0')}:${currentStartTime.getMinutes().toString().padStart(2, '0')}`;
                        const currentEndDisplay = `${currentEndTime.getHours().toString().padStart(2, '0')}:${currentEndTime.getMinutes().toString().padStart(2, '0')}`;
                        
                        console.log('✅ Current hour found:', {
                            time: `${currentStartDisplay}-${currentEndDisplay}`,
                            success_qty: currentHour.success_qty,
                            fail_qty: currentHour.fail_qty,
                            quality: currentHour.quality !== null && currentHour.quality !== undefined ? (currentHour.quality * 100).toFixed(0) + '%' : 'N/A',
                            performance: currentHour.performance !== null && currentHour.performance !== undefined ? (currentHour.performance * 100).toFixed(1) + '%' : 'N/A',
                            oee: currentHour.oee !== null && currentHour.oee !== undefined ? (currentHour.oee * 100).toFixed(0) + '%' : 'N/A'
                        });
                    } else {
                        console.warn('❌ No current hour found in hourly data');
                    }

                    // Compare with previous data if exists
                    if (unitContainers[unitName] && unitContainers[unitName].lastData) {
                        const oldData = unitContainers[unitName].lastData;
                        if (oldData && oldData.hourly_data) {
                            // Check if total success quantity changed
                            const oldSuccess = oldData.total_success || 0;
                            const newSuccess = data.total_success || 0;
                            if (oldSuccess !== newSuccess) {
                                console.log(`Total success changed for "${unitName}": ${oldSuccess} -> ${newSuccess}`);
                            }

                            // Check all hours for changes
                            if (data.hourly_data && data.hourly_data.length > 0 && oldData.hourly_data.length > 0) {
                                // Get current time
                                const now = new Date();

                                // Check each hour in new data against old data
                                data.hourly_data.forEach(newHour => {
                                    const hourStart = new Date(newHour.hour_start);
                                    // Find matching hour in old data
                                    const oldHour = oldData.hourly_data.find(h =>
                                        new Date(h.hour_start).getTime() === hourStart.getTime()
                                    );

                                    if (oldHour) {
                                        // Check if quantities changed
                                        if (oldHour.success_qty !== newHour.success_qty) {
                                            console.log(`Hour ${hourStart.getHours()}:00 success changed: ${oldHour.success_qty} -> ${newHour.success_qty}`);
                                        }
                                        if (oldHour.fail_qty !== newHour.fail_qty) {
                                            console.log(`Hour ${hourStart.getHours()}:00 fail changed: ${oldHour.fail_qty} -> ${newHour.fail_qty}`);
                                        }
                                    } else {
                                        console.log(`New hour added: ${hourStart.getHours()}:00`);
                                    }
                                });
                            }
                        }
                    }
                }

                // Store the data for future comparison (create a deep copy)
                if (unitContainers[unitName]) {
                    unitContainers[unitName].lastData = JSON.parse(JSON.stringify(data));
                }

                // Always update the display for both initial and subsequent data
                if (!hasReceivedInitialData) {
                    hasReceivedInitialData = true;
                    clearTimeout(connectionTimeout);
                    callback(data);
                }
                
                // PRODUCTION FIX: ALWAYS update the display for real-time table updates with batched rendering
                console.log(`[TABLE UPDATE] Updating display for "${unitName}" with fresh data`);
                
                // CRITICAL: Use multiple update strategies to ensure UI updates never fail
                requestAnimationFrame(() => {
                    try {
                    createOrUpdateHourlyDataDisplay(unitName, data);
                    updateLastUpdateTime();
                        markSuccessfulUpdate(); // Mark successful data processing
                        console.log(`✅ [TABLE UPDATE] Display update completed for "${unitName}"`);
                    } catch (error) {
                        console.error(`❌ [TABLE UPDATE] Error updating display for "${unitName}":`, error);
                        
                        // FALLBACK: Direct update if requestAnimationFrame fails
                        try {
                            createOrUpdateHourlyDataDisplay(unitName, data);
                            updateLastUpdateTime();
                            markSuccessfulUpdate();
                            console.log(`🔄 [TABLE UPDATE] Fallback update successful for "${unitName}"`);
                        } catch (fallbackError) {
                            console.error(`💥 [TABLE UPDATE] Fallback update also failed for "${unitName}":`, fallbackError);
                        }
                    }
                });
            }
        } catch (error) {
            console.error(`Error parsing hourly data for "${unitName}":`, error);
            console.error(`Raw data received: ${event.data.substring(0, 100)}...`);

            if (!hasReceivedInitialData) {
                hasReceivedInitialData = true;
                clearTimeout(connectionTimeout);
                callback(null);
            }
        }
    };

    unitSocket.onerror = (error) => {
        console.error(`Hourly WebSocket error for ${unitName}:`, error);

        // Clean up intervals
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }

        // Count as completed but with no data
        if (!hasReceivedInitialData) {
            hasReceivedInitialData = true;
            clearTimeout(connectionTimeout);
            callback(null);
        }
    };

    unitSocket.onclose = (event) => {
        console.log(`Hourly WebSocket closed for ${unitName}:`, event);

        // Clean up intervals
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }

        // Make sure we call callback if we haven't received initial data yet
        if (!hasReceivedInitialData) {
            hasReceivedInitialData = true;
            clearTimeout(connectionTimeout);
            callback(null);
            return;
        }

        // Handle reconnection logic for unexpected closures
        // CRITICAL FIX: Heartbeat timeouts should trigger reconnection even if wasClean=true
        const isHeartbeatTimeout = event.reason === 'Heartbeat timeout';
        const shouldReconnect = (!event.wasClean || isHeartbeatTimeout) && reconnectAttempts < maxReconnectAttempts;
        
        console.log(`[RECONNECT DEBUG] wasClean: ${event.wasClean}, reason: "${event.reason}", isHeartbeatTimeout: ${isHeartbeatTimeout}, shouldReconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
            console.log(`Attempting to reconnect for ${unitName}, attempt ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
            reconnectAttempts++;

            // Exponential backoff with reasonable limits for hourly data
            const reconnectDelay = Math.min(3000 * Math.pow(1.5, reconnectAttempts), 15000); // Start at 3s, max 15s

            console.log(`[HOURLY RECONNECT] Will attempt to reconnect ${unitName} in ${reconnectDelay}ms (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);

            setTimeout(() => {
                if (!unitSockets[unitName] || unitSockets[unitName].readyState === WebSocket.CLOSED) {
                    console.log(`[HOURLY RECONNECT] Attempting to reconnect ${unitName}`);
                    connectHourlyWebSocket(unitName, startTime, endTime, (data) => {
                        // Force immediate UI update after reconnection
                        if (data) {
                            requestAnimationFrame(() => {
                                createOrUpdateHourlyDataDisplay(unitName, data);
                                updateLastUpdateTime();
                            });
                        }
                    });
                }
            }, reconnectDelay);
        } else if (shouldReconnect === false && reconnectAttempts >= maxReconnectAttempts) {
            console.error(`Failed to connect to WebSocket for ${unitName} after ${maxReconnectAttempts} attempts`);
            
            // HEARTBEAT TIMEOUT FIX: Set connection error for display instead of alert
            if (!hourlyDataGlobal[unitName]) {
                hourlyDataGlobal[unitName] = {};
            }
            hourlyDataGlobal[unitName].connectionError = `Connection failed after ${maxReconnectAttempts} attempts. Please check your network connection.`;
            
            callback(null);
        } else if (!shouldReconnect && event.wasClean && !isHeartbeatTimeout) {
            console.log(`[CLEAN CLOSE] WebSocket closed cleanly for ${unitName} - no reconnection needed`);
        } else if (isHeartbeatTimeout && !shouldReconnect) {
            console.warn(`[HEARTBEAT TIMEOUT] Max reconnection attempts reached for ${unitName} after heartbeat timeout`);
        }
    };
}

// Debug function to test historical vs live detection (call from browser console)
window.debugTimeStatus = function() {
    const now = new Date();
    const timeDifference = now.getTime() - endTime.getTime();
    const fiveMinutesInMs = 5 * 60 * 1000;
    const isHistorical = timeDifference > fiveMinutesInMs;

    console.log('=== DEBUG TIME STATUS ===');
    console.log('Current time:', now.toISOString());
    console.log('EndTime:', endTime.toISOString());
    console.log('Time difference (ms):', timeDifference);
    console.log('Time difference (seconds):', Math.round(timeDifference / 1000));
    console.log('Time difference (minutes):', Math.round(timeDifference / (1000 * 60)));
    console.log('5 minute threshold (ms):', fiveMinutesInMs);
    console.log('Is Historical:', isHistorical);
    console.log('========================');

    return {
        currentTime: now,
        endTime: endTime,
        timeDifferenceSeconds: Math.round(timeDifference / 1000),
        isHistorical: isHistorical
    };
};

// Debug function to force live mode (call from browser console)
window.forceLiveMode = function() {
    console.log('[DEBUG] Forcing live mode...');
    const now = new Date();
    const oldEndTime = endTime.toISOString();
    endTime = now;
    console.log(`[DEBUG] EndTime forced: ${oldEndTime} → ${endTime.toISOString()}`);

    updateCurrentTime();
    updateLastUpdateTime();
    forceDataRefreshAllUnits();

    console.log('[DEBUG] Live mode forced - UI updated');
    return debugTimeStatus();
};

// Centralized function to check if data is historical (for historical data views end time is less than 5 minutes before current time)
function isDataHistorical() {
    if (!endTime) return false;

    // CRITICAL FIX: For shift-based views, always treat as live data
    const isShiftBasedView = timePresetValue && timePresetValue.startsWith('shift');
    if (isShiftBasedView) {
        console.log('[HOURLY LIVE] Shift-based view detected - treating as live data');
        return false; // Always live for shift-based views
    }

    const now = new Date();
    const timeDifference = now.getTime() - endTime.getTime();
    const fiveMinutesInMs = 5 * 60 * 1000;

    return timeDifference > fiveMinutesInMs;
}

// CRITICAL FIX: Global status monitoring system to prevent permanent freezing
let shiftChangeStartTime = null;

function startStatusMonitoring() {
    // Clear any existing monitor
    if (statusMonitorInterval) {
        clearInterval(statusMonitorInterval);
    }
    
    // SIMPLIFIED: Less aggressive connection health monitoring
    const connectionHealthInterval = setInterval(() => {
        for (const unitName in unitSockets) {
            const socket = unitSockets[unitName];
            
            // Only check for completely CLOSED states (not CLOSING to avoid race conditions)
            if (!socket || socket.readyState === WebSocket.CLOSED) {
                console.warn(`[CONNECTION HEALTH] Dead connection detected for ${unitName} - marking for cleanup`);
                
                // Clean up without immediate reconnection (let global recovery handle it)
                if (socket) {
                    try {
                        socket.close();
                    } catch (e) {
                        console.warn('Error closing dead socket:', e);
                    }
                }
                delete unitSockets[unitName];
            }
        }
    }, 30000); // Check every 30 seconds (much less aggressive)
    
    // Store the interval for cleanup
    window.connectionHealthInterval = connectionHealthInterval;
    
    statusMonitorInterval = setInterval(() => {
        const now = Date.now();
        const timeSinceLastUpdate = now - lastSuccessfulUpdate;
        
        // CRITICAL: Monitor shift change flag to prevent permanent blocking
        if (isShiftChangeInProgress) {
            if (!shiftChangeStartTime) {
                shiftChangeStartTime = now;
            } else {
                const shiftChangeTime = now - shiftChangeStartTime;
                if (shiftChangeTime > 15000) { // 15 seconds max for shift change
                    console.warn(`[STATUS MONITOR] isShiftChangeInProgress stuck for ${Math.round(shiftChangeTime/1000)}s - force clearing`);
                    isShiftChangeInProgress = false;
                    shiftChangeStartTime = null;
                }
            }
        } else {
            shiftChangeStartTime = null;
        }
        
        // Check if updating status has been stuck for too long
        if (lastUpdateDisplay && lastUpdateDisplay.innerHTML === 'Güncelleniyor...') {
            const stuckTime = timeSinceLastUpdate;
            
            if (stuckTime > 30000) { // 30 seconds stuck
                console.warn(`[STATUS MONITOR] Updating status stuck for ${Math.round(stuckTime/1000)}s - forcing recovery`);
                
                // Force status update
                updateLastUpdateTime();
                
                // Check WebSocket health and force reconnection if needed
                let deadConnections = 0;
                for (const unitName in unitSockets) {
                    const socket = unitSockets[unitName];
                    if (!socket || socket.readyState !== WebSocket.OPEN) {
                        deadConnections++;
                        console.warn(`[STATUS MONITOR] Dead connection detected for ${unitName} (state: ${socket ? socket.readyState : 'null'}) - forcing reconnection`);
                        
                        // Clear the dead socket first
                        if (socket) {
                            socket.close();
                        }
                        delete unitSockets[unitName];
                        
                        // Reconnect this unit
                        setTimeout(() => {
                            console.log(`[STATUS MONITOR] Reconnecting ${unitName}...`);
                            connectHourlyWebSocket(unitName, startTime, endTime, (data) => {
                                if (data) {
                                    createOrUpdateHourlyDataDisplay(unitName, data);
                                    updateLastUpdateTime();
                                    console.log(`[STATUS MONITOR] Successfully reconnected ${unitName}`);
                                }
                            });
                        }, 1000 * deadConnections); // Stagger reconnections
                    }
                }
                
                if (deadConnections === 0) {
                    // All connections appear healthy but status is stuck - force refresh
                    console.warn(`[STATUS MONITOR] Connections appear healthy but status stuck - forcing data refresh`);
                    forceDataRefreshAllUnits();
                }
            }
        } else {
            // Status not stuck - update last successful time
            lastSuccessfulUpdate = now;
        }
        
        // Also check for completely silent connections (no activity for 5 minutes)
        if (timeSinceLastUpdate > 300000) { // 5 minutes
            console.warn(`[STATUS MONITOR] No activity for ${Math.round(timeSinceLastUpdate/1000)}s - forcing complete refresh`);
            window.location.reload(); // Force page reload as last resort
        }
    }, 10000); // Check every 10 seconds
}

function stopStatusMonitoring() {
    if (statusMonitorInterval) {
        clearInterval(statusMonitorInterval);
        statusMonitorInterval = null;
    }
    
    // Clean up connection health monitoring
    if (window.connectionHealthInterval) {
        clearInterval(window.connectionHealthInterval);
        window.connectionHealthInterval = null;
    }
}

// Update the successful update timestamp when data is processed
function markSuccessfulUpdate() {
    lastSuccessfulUpdate = Date.now();
}

// EMERGENCY DIAGNOSTICS: Functions for debugging table update issues
window.debugTableUpdates = function() {
    console.log('=== TABLE UPDATE DIAGNOSTICS ===');
    console.log('isShiftChangeInProgress:', isShiftChangeInProgress);
    console.log('endTime:', endTime.toISOString());
    console.log('timePresetValue:', timePresetValue);
    console.log('WebSocket states:');
    
    let healthyConnections = 0;
    let totalConnections = 0;
    
    for (const unitName in unitSockets) {
        const socket = unitSockets[unitName];
        totalConnections++;
        
        const state = socket ? socket.readyState : 'null';
        const isInvalid = socket ? socket._isInvalid : 'null';
        const stateText = socket ? 
            (socket.readyState === WebSocket.OPEN ? 'OPEN' :
             socket.readyState === WebSocket.CONNECTING ? 'CONNECTING' :
             socket.readyState === WebSocket.CLOSING ? 'CLOSING' :
             socket.readyState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN') : 'NULL';
             
        console.log(`  ${unitName}: readyState=${state} (${stateText}), _isInvalid=${isInvalid}`);
        
        if (socket && socket.readyState === WebSocket.OPEN && !socket._isInvalid) {
            healthyConnections++;
        }
    }
    
    console.log(`Health Summary: ${healthyConnections}/${totalConnections} connections healthy`);
    console.log('Unit containers:', Object.keys(unitContainers));
    
    // Check for recent activity
    const timeSinceLastUpdate = Date.now() - lastSuccessfulUpdate;
    console.log(`Time since last successful update: ${Math.round(timeSinceLastUpdate/1000)} seconds`);
    
    if (timeSinceLastUpdate > 30000) {
        console.warn('⚠️ WARNING: No successful updates in over 30 seconds');
    }
    
    console.log('=== END DIAGNOSTICS ===');
};

window.forceTableRefresh = function() {
    console.log('=== FORCE TABLE REFRESH ===');
    if (isShiftChangeInProgress) {
        console.log('WARNING: isShiftChangeInProgress is true - clearing it');
        isShiftChangeInProgress = false;
    }
    
    // Update endTime for live data
    endTime = new Date();
    console.log('Updated endTime to:', endTime.toISOString());
    
    // Force refresh all units
    forceDataRefreshAllUnits();
    console.log('=== REFRESH COMPLETE ===');
};

window.forceReconnectAll = function() {
    console.log('=== FORCE RECONNECT ALL WEBSOCKETS ===');
    
    // Close all existing connections
    for (const unitName in unitSockets) {
        const socket = unitSockets[unitName];
        if (socket) {
            console.log(`Closing connection for ${unitName}`);
            try {
                socket.close(1000, 'Manual reconnection');
            } catch (e) {
                console.warn(`Error closing socket for ${unitName}:`, e);
            }
        }
        delete unitSockets[unitName];
    }
    
    // Update endTime for live data
    endTime = new Date();
    console.log('Updated endTime to:', endTime.toISOString());
    
    // Reconnect all units
    console.log('Reconnecting all units...');
    selectedUnits.forEach((unitName, index) => {
        setTimeout(() => {
            console.log(`Reconnecting ${unitName}...`);
            connectHourlyWebSocket(unitName, startTime, endTime, (data) => {
                if (data) {
                    createOrUpdateHourlyDataDisplay(unitName, data);
                    updateLastUpdateTime();
                    console.log(`Successfully reconnected ${unitName}`);
                }
            });
        }, 1000 * index); // Stagger connections
    });
    
    console.log('=== RECONNECTION INITIATED ===');
};

// PRODUCTION FIX: Enhanced monitoring and auto-recovery system
window.quickFixTables = function() {
    console.log('=== QUICK FIX TABLES (PRODUCTION URGENT FIX) ===');
    
    // Step 1: Clear any blocking flags immediately
    if (isShiftChangeInProgress) {
        console.warn('🚨 PRODUCTION FIX: Clearing stuck isShiftChangeInProgress flag');
        isShiftChangeInProgress = false;
    }
    
    // Step 2: Force update endTime for live data
    const oldEndTime = endTime.toISOString();
    endTime = new Date();
    console.log(`🕒 PRODUCTION FIX: Updated endTime from ${oldEndTime} to ${endTime.toISOString()}`);
    
    // Step 3: Check and fix connection health
    let unhealthyConnections = 0;
    for (const unitName in unitSockets) {
        const socket = unitSockets[unitName];
        if (!socket || socket.readyState !== WebSocket.OPEN || socket._isInvalid) {
            unhealthyConnections++;
            console.warn(`🔴 PRODUCTION FIX: Unhealthy connection for ${unitName} - state: ${socket ? socket.readyState : 'null'}`);
        }
    }
    
    // Step 4: If any connections are unhealthy, force reconnect all
    if (unhealthyConnections > 0) {
        console.warn(`🚨 PRODUCTION FIX: ${unhealthyConnections} unhealthy connections detected - forcing full reconnect`);
        window.forceReconnectAll();
    } else {
        // Step 5: All connections healthy, force data refresh
        console.log('✅ PRODUCTION FIX: Connections healthy - forcing data refresh');
        forceDataRefreshAllUnits();
    }
    
    // Step 6: Update status immediately
    updateLastUpdateTime();
    
    console.log('=== QUICK FIX COMPLETE ===');
    
    // Return status for automation
    return {
        blockedFlags: isShiftChangeInProgress,
        endTimeUpdated: endTime.toISOString(),
        unhealthyConnections: unhealthyConnections,
        totalConnections: Object.keys(unitSockets).length
    };
};

// PRODUCTION FIX: Auto-recovery system that runs every 30 seconds
let productionAutoRecovery = null;

window.startProductionAutoRecovery = function() {
    if (productionAutoRecovery) {
        clearInterval(productionAutoRecovery);
    }
    
    console.log('🚀 PRODUCTION AUTO-RECOVERY: Starting aggressive monitoring');
    
    productionAutoRecovery = setInterval(() => {
        const now = Date.now();
        const timeSinceLastUpdate = now - lastSuccessfulUpdate;
        
        // Only auto-fix if no updates for 2 minutes (more conservative)
        if (timeSinceLastUpdate > 120000) {
            console.warn(`🚨 PRODUCTION AUTO-RECOVERY: No updates for ${Math.round(timeSinceLastUpdate/1000)}s - performing conservative fix`);
            
            // First try a gentle refresh before nuclear option
            forceDataRefreshAllUnits();
            
            // Only call quickFixTables as last resort after 3 minutes
            if (timeSinceLastUpdate > 180000) {
                console.warn(`🚨 PRODUCTION AUTO-RECOVERY: Still no updates after 3 minutes - calling quickFixTables`);
                window.quickFixTables();
            }
        }
        
        // SIMPLIFIED: Only check for completely dead connections (not individual unit issues)
        let deadConnections = 0;
        for (const unitName in unitSockets) {
            const socket = unitSockets[unitName];
            if (!socket || socket.readyState === WebSocket.CLOSED) {
                deadConnections++;
                console.warn(`💀 PRODUCTION AUTO-RECOVERY: Dead connection for ${unitName}`);
            }
        }
        
        // If more than half connections are dead, fix them
        const totalConnections = Object.keys(unitSockets).length;
        if (deadConnections > totalConnections / 2 && deadConnections > 0) {
            console.warn(`💀 PRODUCTION AUTO-RECOVERY: ${deadConnections}/${totalConnections} connections dead - fixing`);
            window.fixFrozenUnits();
        }
        
        // Check for stuck shift change flag (this is safe to clear)
        if (isShiftChangeInProgress) {
            console.warn('🚨 PRODUCTION AUTO-RECOVERY: Shift change flag stuck - clearing');
            isShiftChangeInProgress = false;
        }
    }, 60000); // Check every 60 seconds (less aggressive)
    
    console.log('✅ PRODUCTION AUTO-RECOVERY: Monitoring active');
};

window.stopProductionAutoRecovery = function() {
    if (productionAutoRecovery) {
        clearInterval(productionAutoRecovery);
        productionAutoRecovery = null;
        console.log('🛑 PRODUCTION AUTO-RECOVERY: Monitoring stopped');
    }
};

// PRODUCTION DEBUG: Enhanced diagnostic tools for live debugging
window.productionDiagnostics = function() {
    console.log('🔍 === PRODUCTION DIAGNOSTICS ===');
    
    const now = Date.now();
    const timeSinceLastUpdate = now - lastSuccessfulUpdate;
    
    console.log('⏰ System Status:');
    console.log(`   - Time since last update: ${Math.round(timeSinceLastUpdate/1000)}s`);
    console.log(`   - isShiftChangeInProgress: ${isShiftChangeInProgress}`);
    console.log(`   - endTime: ${endTime.toISOString()}`);
    console.log(`   - timePresetValue: ${timePresetValue}`);
    console.log(`   - Current time: ${new Date().toISOString()}`);
    
    console.log('🌐 WebSocket Status:');
    let healthyCount = 0;
    let totalCount = 0;
    
    for (const unitName in unitSockets) {
        const socket = unitSockets[unitName];
        totalCount++;
        
        const isHealthy = socket && socket.readyState === WebSocket.OPEN && !socket._isInvalid;
        if (isHealthy) healthyCount++;
        
        const statusIcon = isHealthy ? '✅' : '❌';
        const state = socket ? socket.readyState : 'null';
        const isInvalid = socket ? socket._isInvalid : 'null';
        
        console.log(`   ${statusIcon} ${unitName}: state=${state}, invalid=${isInvalid}`);
    }
    
    console.log(`📊 Health Summary: ${healthyCount}/${totalCount} connections healthy`);
    
    console.log('🏗️ UI Status:');
    console.log(`   - Unit containers: ${Object.keys(unitContainers).length}`);
    console.log(`   - Selected units: ${selectedUnits.length}`);
    console.log(`   - Last update display: ${lastUpdateDisplay ? lastUpdateDisplay.innerHTML : 'null'}`);
    
    if (timeSinceLastUpdate > 30000) {
        console.warn('⚠️ WARNING: System appears stuck - consider running quickFixTables()');
    }
    
    console.log('🔍 === END DIAGNOSTICS ===');
    
    return {
        timeSinceLastUpdate: Math.round(timeSinceLastUpdate/1000),
        healthyConnections: healthyCount,
        totalConnections: totalCount,
        isShiftChangeInProgress: isShiftChangeInProgress,
        endTime: endTime.toISOString(),
        recommendation: timeSinceLastUpdate > 30000 ? 'Run quickFixTables()' : 'System appears healthy'
    };
};

// PRODUCTION EMERGENCY: Last resort table refresh that bypasses everything
window.emergencyTableRefresh = function() {
    console.log('🚨 === EMERGENCY TABLE REFRESH ===');
    console.log('⚠️ WARNING: This is a last resort measure that bypasses all safety checks');
    
    // Step 1: Clear ALL possible blocking flags
    isShiftChangeInProgress = false;
    console.log('🧹 Cleared isShiftChangeInProgress flag');
    
    // Step 2: Force update endTime aggressively
    endTime = new Date();
    console.log(`🕒 Force updated endTime to: ${endTime.toISOString()}`);
    
    // Step 3: Destroy all existing connections
    console.log('💥 Destroying all WebSocket connections...');
    for (const unitName in unitSockets) {
        const socket = unitSockets[unitName];
        if (socket) {
            try {
                socket.close(1000, 'Emergency refresh');
            } catch (e) {
                console.warn(`Failed to close socket for ${unitName}:`, e);
            }
        }
    }
    unitSockets = {};
    
    // Step 4: Clear all intervals and monitoring
    stopStatusMonitoring();
    window.stopProductionAutoRecovery();
    
    // Step 5: Force page reload as absolute last resort
    setTimeout(() => {
        console.warn('🔄 Emergency: Forcing page reload in 5 seconds...');
        setTimeout(() => {
            window.location.reload();
        }, 5000);
    }, 1000);
    
    console.log('🚨 === EMERGENCY REFRESH INITIATED ===');
};

// PRODUCTION FIX: Specific tool to detect and fix individual unit freezing
window.fixFrozenUnits = function() {
    console.log('🧊 === FIX FROZEN UNITS ===');
    
    const now = Date.now();
    const frozenUnits = [];
    const healthyUnits = [];
    
    // Check each unit container for last update time
    for (const unitName in unitContainers) {
        const container = unitContainers[unitName];
        const socket = unitSockets[unitName];
        
        if (!container) {
            console.warn(`❌ Unit ${unitName}: No container found`);
            frozenUnits.push(unitName);
            continue;
        }
        
        if (!socket) {
            console.warn(`❌ Unit ${unitName}: No WebSocket connection`);
            frozenUnits.push(unitName);
            continue;
        }
        
        if (socket.readyState !== WebSocket.OPEN) {
            console.warn(`❌ Unit ${unitName}: WebSocket not open (state: ${socket.readyState})`);
            frozenUnits.push(unitName);
            continue;
        }
        

        
        console.log(`✅ Unit ${unitName}: Healthy`);
        healthyUnits.push(unitName);
    }
    
    console.log(`📊 Health Summary: ${healthyUnits.length} healthy, ${frozenUnits.length} frozen`);
    
    if (frozenUnits.length === 0) {
        console.log('🎉 All units healthy - no action needed');
        return { frozenUnits: [], healthyUnits, action: 'none' };
    }
    
    // Fix frozen units individually
    console.log(`🔧 Fixing ${frozenUnits.length} frozen units...`);
    
    frozenUnits.forEach((unitName, index) => {
        setTimeout(() => {
            console.log(`🔄 Reconnecting frozen unit: ${unitName}`);
            
            // Close existing connection if any
            if (unitSockets[unitName]) {
                try {
                    unitSockets[unitName].close(1000, 'Frozen unit recovery');
                } catch (e) {
                    console.warn(`Error closing socket for ${unitName}:`, e);
                }
                delete unitSockets[unitName];
            }
            
            // Clear invalid flag and reconnect
            connectHourlyWebSocket(unitName, startTime, endTime, (data) => {
                if (data) {
                    createOrUpdateHourlyDataDisplay(unitName, data);
                    updateLastUpdateTime();
                    console.log(`✅ Successfully unfroze unit: ${unitName}`);
                } else {
                    console.warn(`❌ Failed to unfreeze unit: ${unitName}`);
                }
            });
        }, 1000 * index); // Stagger reconnections
    });
    
    console.log('🧊 === FIX INITIATED ===');
    
    return {
        frozenUnits,
        healthyUnits,
        action: 'reconnecting',
        message: `Reconnecting ${frozenUnits.length} frozen units`
    };
};
