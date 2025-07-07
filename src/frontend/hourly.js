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

    // Create connections for each selected unit
    let completedRequests = 0;

    selectedUnits.forEach(unit => {
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
            }
        });
    });
}

// Create or update hourly data display for a unit
function createOrUpdateHourlyDataDisplay(unitName, data) {
    // CRITICAL FIX: Allow UI updates during shift change - data freshness is more important than avoiding flicker
    if (isShiftChangeInProgress) {
        console.log(`[SHIFT CHANGE] Proceeding with UI update during shift change for "${unitName}" (data freshness priority)`);
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
    // FIXED: Allow UI updates during shift change - data freshness is more important
    if (isShiftChangeInProgress) {
        console.log(`[SHIFT CHANGE] Proceeding with UI update during shift change for "${unitName}" (data freshness priority)`);
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

    // Filter out invalid hours
    const validHours = hourDataCopy.filter(hour =>
        hour._startDate instanceof Date && !isNaN(hour._startDate) &&
        hour._endDate instanceof Date && !isNaN(hour._endDate)
    );

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
    const maxReconnectAttempts = 5;
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
    }, 8000); // 8 second timeout for hourly data (faster for better responsiveness)

    function sendDataRequest() {
        // Check if this connection is marked as invalid (from previous shift)
        if (unitSocket._isInvalid) {
            console.log(`[SHIFT CHANGE] Stopping data requests from invalid connection for "${unitName}"`);
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }
            return;
        }

        // CRITICAL FIX: Always allow data requests - data freshness is top priority
        if (isShiftChangeInProgress) {
            console.log(`[SHIFT CHANGE] Processing data request during shift change for "${unitName}" (data freshness priority)`);
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
                // For non-shift views, use original logic
                requestEndTime = currentTime;
            }

            // Send parameters to request new data
            const params = {
                start_time: startTimeISO, // Reuse pre-calculated value
                end_time: requestEndTime.toISOString(),
                working_mode: workingMode // Reuse pre-calculated value
            };

            console.log(`[HOURLY REQUEST] ${unitName}: ${isShiftBasedView ? 'Shift-based live' : 'Live'} data request - endTime: ${requestEndTime.toISOString()}`);

            try {
            unitSocket.send(JSON.stringify(params));
                
                // CRITICAL FIX: Set a response timeout to detect silent failures
                if (unitSocket.responseTimeout) {
                    clearTimeout(unitSocket.responseTimeout);
                }
                
                unitSocket.responseTimeout = setTimeout(() => {
                    console.warn(`[STATUS FIX] No response received for ${unitName} within 20 seconds - checking connection`);
                    
                    // Check if socket is still open but not responding
                    if (unitSocket.readyState === WebSocket.OPEN) {
                        console.warn(`[STATUS FIX] Socket appears open but unresponsive for ${unitName} - forcing reconnection`);
                        unitSocket.close(1000, 'Response timeout');
                    }
                }, 20000); // 20 second response timeout
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
            // Only send request if connection is still open
            if (unitSocket.readyState === WebSocket.OPEN) {
                // For background tabs, skip fewer requests (hourly data is most critical)
                const shouldSkipRequest = !isTabVisible && Math.random() < 0.15; // Skip only 15% of requests when hidden (less than other views)
                
                if (!shouldSkipRequest) {
                    sendDataRequest();
                } else {
                    console.log(`[HOURLY OPTIMIZATION] Skipping background request for ${unitName}`);
                }
            } else {
                console.log(`[HOURLY ERROR] Connection lost for ${unitName}, clearing interval`);
                clearInterval(updateInterval);
                updateInterval = null;
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
            
            // Update heartbeat timestamp
            lastHeartbeat = Date.now();
            
                    // Check if this connection is marked as invalid (from previous shift)
        if (unitSocket._isInvalid) {
            console.log(`[SHIFT CHANGE] Ignoring data from invalid connection for "${unitName}"`);
            return;
        }

        // CRITICAL FIX: Allow all data processing during shift change - data freshness is top priority
        if (isShiftChangeInProgress) {
            console.log(`[SHIFT CHANGE] Processing data during shift change for "${unitName}" (data freshness priority)`);
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
                        console.log(`${startTime.getHours()}:00-${endTime.getHours()}:00: Success=${hour.success_qty}, Fail=${hour.fail_qty}, Quality=${hour.quality !== null && hour.quality !== undefined ? (hour.quality * 100).toFixed(0) : 'N/A'}%`);
                    });

                    // Find current hour
                    const now = new Date();
                    const currentHour = data.hourly_data.find(h => {
                        const hourStart = new Date(h.hour_start);
                        const hourEnd = new Date(h.hour_end);
                        return hourStart <= now && now < hourEnd;
                    });

                    if (currentHour) {
                        console.log('Current hour data:', {
                            time: `${new Date(currentHour.hour_start).getHours()}:00-${new Date(currentHour.hour_end).getHours()}:00`,
                            success_qty: currentHour.success_qty,
                            fail_qty: currentHour.fail_qty,
                            quality: currentHour.quality !== null && currentHour.quality !== undefined ? (currentHour.quality * 100).toFixed(0) + '%' : 'N/A',
                            performance: currentHour.performance !== null && currentHour.performance !== undefined ? (currentHour.performance * 100).toFixed(1) + '%' : 'N/A',
                            oee: currentHour.oee !== null && currentHour.oee !== undefined ? (currentHour.oee * 100).toFixed(0) + '%' : 'N/A'
                        });
                    } else {
                        console.warn('No current hour found in hourly data');
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
                
                // ALWAYS update the display for real-time table updates with batched rendering
                console.log(`[TABLE UPDATE] Updating display for "${unitName}" with fresh data`);
                requestAnimationFrame(() => {
                    createOrUpdateHourlyDataDisplay(unitName, data);
                    updateLastUpdateTime();
                    markSuccessfulUpdate(); // Mark successful data processing
                    console.log(`[TABLE UPDATE] Display update completed for "${unitName}"`);
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

        // Clean up intervals and heartbeat
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        if (unitSocket.heartbeatInterval) {
            clearInterval(unitSocket.heartbeatInterval);
            unitSocket.heartbeatInterval = null;
        }

        // Count as completed but with no data
        callback(null);
    };

    unitSocket.onclose = (event) => {
        console.log(`Hourly WebSocket closed for ${unitName}:`, event);

        // Clean up intervals and heartbeat
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        if (unitSocket.heartbeatInterval) {
            clearInterval(unitSocket.heartbeatInterval);
            unitSocket.heartbeatInterval = null;
        }

        // CRITICAL FIX: Treat heartbeat timeout (code 1000) as requiring reconnection
        const isHeartbeatTimeout = event.reason && event.reason.includes('timeout');
        const shouldReconnect = (!event.wasClean || isHeartbeatTimeout) && reconnectAttempts < maxReconnectAttempts;
        
        console.log(`[RECONNECT DEBUG] wasClean: ${event.wasClean}, reason: "${event.reason}", isHeartbeatTimeout: ${isHeartbeatTimeout}, shouldReconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
            console.log(`Attempting to reconnect for ${unitName}, attempt ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
            reconnectAttempts++;

            // OPTIMIZED: Exponential backoff with reasonable limits for hourly data
            const reconnectDelay = Math.min(5000 * Math.pow(1.5, reconnectAttempts), 30000); // Exponential backoff, max 30s

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
            alert(`Failed to connect to ${unitName}. Please try again later.`);
            callback(null);
        } else if (!shouldReconnect && event.wasClean && !isHeartbeatTimeout) {
            console.log(`[CLEAN CLOSE] WebSocket closed cleanly for ${unitName} - no reconnection needed`);
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
    
    // CRITICAL: Add frequent connection health check for heartbeat timeout detection
    const connectionHealthInterval = setInterval(() => {
        let unhealthyConnections = 0;
        for (const unitName in unitSockets) {
            const socket = unitSockets[unitName];
            
            // Check for CLOSING or CLOSED states that might not have triggered onclose yet
            if (!socket || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
                unhealthyConnections++;
                console.warn(`[CONNECTION HEALTH] Unhealthy connection for ${unitName} (state: ${socket ? socket.readyState : 'null'}) - forcing immediate reconnection`);
                
                // Immediately clean up and reconnect
                if (socket) {
                    try {
                        socket.close();
                    } catch (e) {
                        console.warn('Error closing socket:', e);
                    }
                }
                delete unitSockets[unitName];
                
                // Reconnect immediately
                setTimeout(() => {
                    console.log(`[CONNECTION HEALTH] Emergency reconnecting ${unitName}...`);
                    connectHourlyWebSocket(unitName, startTime, endTime, (data) => {
                        if (data) {
                            createOrUpdateHourlyDataDisplay(unitName, data);
                            updateLastUpdateTime();
                            console.log(`[CONNECTION HEALTH] Emergency reconnection successful for ${unitName}`);
                        }
                    });
                }, 100 * unhealthyConnections); // Very short delay
            }
        }
    }, 5000); // Check every 5 seconds for connection health
    
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
