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

        // Force another UI update after data refresh
        setTimeout(() => {
            updateCurrentTime();
            updateLastUpdateTime();
            console.log('[VISIBILITY] Forced UI update after data refresh');
        }, 100);
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

                showUpdatingIndicator();
                socket.send(JSON.stringify(params));
            } else {
                console.log(`[VISIBILITY] Skipping refresh for ${unitName} - data is historical`);
            }
        } else {
            console.log(`[VISIBILITY] Skipping ${unitName} - socket not ready (state: ${socket ? socket.readyState : 'null'})`);
        }
    }
}

// Optimized interval management for background tabs
function startOptimizedIntervals() {
    // Clear any existing intervals
    stopOptimizedIntervals();

    // Clock update interval (1 second normally, but handles background throttling)
    clockUpdateInterval = setInterval(updateCurrentTime, 1000);

    // Shift change check (10 seconds normally, but more aggressive when visible)
    const shiftCheckFrequency = isTabVisible ? 10000 : 30000; // 10s when visible, 30s when hidden
    shiftCheckInterval = setInterval(() => {
        if (checkForNewTimePeriod()) {
            console.log('Shift change detected, updating time period...');
            updateTimePeriod();
        }
    }, shiftCheckFrequency);

    // Visibility check to adapt intervals
    visibilityCheckInterval = setInterval(() => {
        const currentVisible = !document.hidden;
        if (currentVisible !== isTabVisible) {
            // Visibility state changed, restart intervals with appropriate frequency
            console.log('[VISIBILITY] Restarting intervals due to visibility change');
            startOptimizedIntervals();
        }
    }, 5000); // Check every 5 seconds

    console.log(`[INTERVALS] Started optimized intervals - tab visible: ${isTabVisible}`);
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

    // Clean up WebSocket connections and intervals when page unloads
    window.addEventListener('beforeunload', () => {
        stopOptimizedIntervals();
        for (const unitName in unitSockets) {
            if (unitSockets[unitName]) {
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
            }
        });
    });
}

// Create or update hourly data display for a unit
function createOrUpdateHourlyDataDisplay(unitName, data) {
    // Skip UI updates during shift change to prevent old data from showing
    if (isShiftChangeInProgress) {
        console.log(`[SHIFT CHANGE] Skipping UI update during shift change for "${unitName}"`);
        return;
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
    // Skip UI updates during shift change to prevent old data from showing
    if (isShiftChangeInProgress) {
        console.log(`[SHIFT CHANGE] Skipping UI update during shift change for "${unitName}"`);
        return;
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
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/hourly/${unitName}`;

    console.log(`Connecting to hourly WebSocket for "${unitName}" at ${wsUrl}`);

    // Create a new WebSocket for this unit
    const unitSocket = new WebSocket(wsUrl);

    // Store the socket for cleanup
    unitSockets[unitName] = unitSocket;

    let reconnectAttempts = 0;
    const maxReconnectAttempts = 3;

    // Set up interval for data refreshing
    let updateInterval = null;
    let hasReceivedInitialData = false;

    // Set a timeout to ensure we get a callback even if WebSocket fails to connect
    const connectionTimeout = setTimeout(() => {
        if (!hasReceivedInitialData) {
            console.warn(`Connection timeout for hourly data "${unitName}". Completing with empty data.`);
            hasReceivedInitialData = true;
            callback(null);
        }
    }, 15000); // 15 second timeout for hourly data (can be longer as it's more complex)

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

        // Check if shift change is in progress
        if (isShiftChangeInProgress) {
            console.log(`[SHIFT CHANGE] Skipping data request during shift change for "${unitName}"`);
            return;
        }

        // For live data, always update endTime to current time
        const now = new Date();
        console.log(`[LIVE DATA] Updating endTime for live view "${unitName}"`);
        console.log(`[LIVE DATA] Old endTime: ${endTime.toISOString()}`);
        endTime = now;
        console.log(`[LIVE DATA] New endTime: ${endTime.toISOString()}`);

        if (unitSocket.readyState === WebSocket.OPEN) {
                showUpdatingIndicator();

            // For live data, always use current time
            const requestEndTime = new Date();

            // Send parameters to request new data
            const params = {
                start_time: startTime.toISOString(),
                end_time: requestEndTime.toISOString(),
                working_mode: workingModeValue || 'mode1'
            };

            console.log(`[DATA REQUEST] ${unitName}: Live data request`, {
                start: params.start_time,
                end: params.end_time
            });

            unitSocket.send(JSON.stringify(params));
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

        // Set up optimized interval to request data
        // Use shorter intervals when tab is visible, longer when background
        const getDataRequestInterval = () => {
            // Base interval: 30 seconds for live data
            const baseInterval = 30000;

            // If tab is in background, use longer interval to avoid unnecessary requests
            // since browser throttling will delay them anyway
            if (!isTabVisible) {
                return Math.max(baseInterval, 60000); // At least 60 seconds when hidden
            }

            return baseInterval; // 30 seconds for live data when visible
        };

        // Create adaptive interval that adjusts based on visibility
        let currentInterval = getDataRequestInterval();
        updateInterval = setInterval(sendDataRequest, currentInterval);

        // Monitor visibility changes and adjust interval accordingly
        const adaptiveIntervalCheck = setInterval(() => {
            const newInterval = getDataRequestInterval();
            if (newInterval !== currentInterval) {
                console.log(`[ADAPTIVE] Updating data request interval for "${unitName}": ${currentInterval}ms → ${newInterval}ms (visible: ${isTabVisible})`);

                // Clear old interval and create new one
                if (updateInterval) {
                    clearInterval(updateInterval);
                }
                updateInterval = setInterval(sendDataRequest, newInterval);
                currentInterval = newInterval;
            }
        }, 10000); // Check every 10 seconds for interval adaptation

        // Store the adaptive check interval for cleanup
        unitSocket._adaptiveInterval = adaptiveIntervalCheck;

        console.log(`[WEBSOCKET] Set up adaptive data requests for "${unitName}" with initial interval: ${currentInterval}ms`);
    };

    unitSocket.onmessage = (event) => {
        try {
            // Check if this connection is marked as invalid (from previous shift)
            if (unitSocket._isInvalid) {
                console.log(`[SHIFT CHANGE] Ignoring data from invalid connection for "${unitName}"`);
                return;
            }

            // Check if shift change is in progress and this might be old data
            if (isShiftChangeInProgress) {
                console.log(`[SHIFT CHANGE] Ignoring data during shift change for "${unitName}"`);
                return;
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

                // Only call the callback once for initial data
                if (!hasReceivedInitialData) {
                    hasReceivedInitialData = true;
                    clearTimeout(connectionTimeout);
                    callback(data);
                } else {
                    // If not the initial load, update the display directly
                    createOrUpdateHourlyDataDisplay(unitName, data);
                    updateLastUpdateTime();
                }
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

        // Clear the update interval and adaptive interval if there's an error
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        if (unitSocket._adaptiveInterval) {
            clearInterval(unitSocket._adaptiveInterval);
            unitSocket._adaptiveInterval = null;
        }

        // Count as completed but with no data
        callback(null);
    };

    unitSocket.onclose = (event) => {
        console.log(`Hourly WebSocket closed for ${unitName}:`, event);

        // Clear the update interval and adaptive interval if the socket is closed
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        if (unitSocket._adaptiveInterval) {
            clearInterval(unitSocket._adaptiveInterval);
            unitSocket._adaptiveInterval = null;
        }

        if (!event.wasClean && reconnectAttempts < maxReconnectAttempts) {
            console.log(`Attempting to reconnect for ${unitName}, attempt ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
            reconnectAttempts++;

            // Use longer reconnect delay if tab is in background to avoid overwhelming the server
            const reconnectDelay = !isTabVisible ?
                Math.min(30000, 1000 * reconnectAttempts * 3) : // Up to 30s when hidden
                1000 * reconnectAttempts; // Standard delay when visible

            console.log(`[RECONNECT] Waiting ${reconnectDelay}ms before reconnect attempt (visible: ${isTabVisible})`);

            setTimeout(() => {
                connectHourlyWebSocket(unitName, startTime, endTime, callback);
            }, reconnectDelay);
        } else if (!event.wasClean && reconnectAttempts >= maxReconnectAttempts) {
            console.error(`Failed to connect to WebSocket for ${unitName} after ${maxReconnectAttempts} attempts`);
            alert(`Failed to connect to ${unitName}. Please try again later.`);
            callback(null);
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

    const now = new Date();
    const timeDifference = now.getTime() - endTime.getTime();
    const fiveMinutesInMs = 5 * 60 * 1000;

    return timeDifference > fiveMinutesInMs;
}
