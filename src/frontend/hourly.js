// DOM Elements
const currentTimeDisplay = document.getElementById('current-time');
const loadingIndicator = document.getElementById('loading-indicator');
const hourlyDataContainer = document.getElementById('hourly-data-container');

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

// Function to check if we need to update to a new time period
function checkForNewTimePeriod() {
    if (!timePresetValue || !startTime || !endTime || !workingModeValue) return false;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDay = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());

    // Only check for updates if we're viewing today's data OR if it's a test scenario
    // Allow test scenarios by checking if the date is in the future (test dates) or today
    const isTestScenario = startDay.getTime() > today.getTime();
    const isToday = startDay.getTime() === today.getTime();
    
    console.log(`[DEBUG checkForNewTimePeriod] now: ${now.toISOString()}, endTime: ${endTime.toISOString()}, startDay: ${startDay.toISOString()}, today: ${today.toISOString()}`);
    console.log(`[DEBUG checkForNewTimePeriod] isToday: ${isToday}, isTestScenario: ${isTestScenario}`);
    
    if (!isToday && !isTestScenario) {
        return false;  // Don't update if viewing historical data (past dates)
    }

    // For test scenarios, use the endTime to simulate being at that time
    // For real scenarios, use current time
    let timeToCheck = now;
    const timeDifference = Math.abs(endTime.getTime() - now.getTime());
    const twoHoursInMs = 2 * 60 * 60 * 1000;
    
    console.log(`[DEBUG checkForNewTimePeriod] Time difference: ${timeDifference}ms, Two hours: ${twoHoursInMs}ms, Should use simulated: ${isToday && timeDifference > twoHoursInMs}`);
    
    if (isToday && timeDifference > twoHoursInMs) {
        // If endTime is more than 2 hours different from now, treat as test scenario
        timeToCheck = endTime;
        console.log(`[DEBUG] Using simulated time for test: ${timeToCheck.toISOString()} instead of real time: ${now.toISOString()}`);
    }
    
    const currentHour = timeToCheck.getHours();
    const currentMinutes = timeToCheck.getMinutes();
    const shifts = workingModes[workingModeValue].shifts;
    
    // Find which shift we should be in now OR the next shift if we're near the end
    let currentShiftConfig = null;
    let isNearCurrentShiftEnd = false;
    
    // First, find the current shift
    for (const shift of shifts) {
        if (shift.crossesMidnight) {
            if ((currentHour >= shift.start) || (currentHour < shift.end)) {
                currentShiftConfig = shift;
                break;
            }
        } else {
            if ((currentHour >= shift.start) && (currentHour < shift.end)) {
                currentShiftConfig = shift;
                
                // Check if we're near the end of this shift
                if (currentHour === (shift.end - 1) && currentMinutes >= 55) {
                    isNearCurrentShiftEnd = true;
                }
                break;
            }
        }
    }
    
    // If we're near the end of current shift, find the next shift
    if (isNearCurrentShiftEnd && currentShiftConfig) {
        console.log(`[DEBUG updateTimePeriod] Near end of shift ${currentShiftConfig.name}, looking for next shift...`);
        
        // Find the next shift
        const currentShiftIndex = shifts.indexOf(currentShiftConfig);
        const nextShiftIndex = (currentShiftIndex + 1) % shifts.length;
        const nextShift = shifts[nextShiftIndex];
        
        console.log(`[DEBUG updateTimePeriod] Next shift found: ${nextShift.name}`);
        currentShiftConfig = nextShift;
        
        // Update the preset to the new shift
        timePresetValue = nextShift.id;
    }
    
    console.log(`[DEBUG updateTimePeriod] Time to check: ${timeToCheck.toISOString()}, Hour: ${currentHour}, Found shift: ${currentShiftConfig?.name || 'None'}, Current preset: ${timePresetValue}, Near end: ${isNearCurrentShiftEnd}`);
    
    if (!currentShiftConfig) {
        console.log(`[DEBUG updateTimePeriod] No active shift found for hour ${currentHour} - returning`);
        return false; // No active shift found
    }
    
    // Check if the start time needs to be updated for midnight-crossing shifts
    if (currentShiftConfig.crossesMidnight) {
        const expectedStartTime = getShiftStartTime(currentShiftConfig, timeToCheck);
        return Math.abs(startTime.getTime() - expectedStartTime.getTime()) > 60000; // More than 1 minute difference
    }
    
    return false;
}

// Helper function to get the correct start time for a shift
function getShiftStartTime(shiftConfig, referenceTime) {
    const today = new Date(referenceTime.getFullYear(), referenceTime.getMonth(), referenceTime.getDate());
    const currentHour = referenceTime.getHours();
    
    if (shiftConfig.crossesMidnight) {
        if (currentHour >= shiftConfig.start) {
            // We're in the first part of the shift (before midnight)
            return new Date(today.setHours(shiftConfig.start, 0, 0, 0));
        } else if (currentHour < shiftConfig.end) {
            // We're in the second part of the shift (after midnight)
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            return new Date(yesterday.setHours(shiftConfig.start, 0, 0, 0));
        }
    }
    
    // For regular shifts or when between shifts
    return new Date(today.setHours(shiftConfig.start, 0, 0, 0));
}

// Function to update time period
function updateTimePeriod() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Only update if we're viewing today's data OR if it's a test scenario
    const startDay = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
    const isTestScenario = startDay.getTime() > today.getTime();
    const isToday = startDay.getTime() === today.getTime();
    
    if (!isToday && !isTestScenario) {
        return;  // Don't update if viewing historical data (past dates)
    }

    // For test scenarios, use the endTime to simulate being at that time
    // For real scenarios, use current time
    let timeToCheck = now;
    if (isToday && Math.abs(endTime.getTime() - now.getTime()) > 2 * 60 * 60 * 1000) {
        // If endTime is more than 2 hours different from now, treat as test scenario
        timeToCheck = endTime;
        console.log(`[DEBUG updateTimePeriod] Using simulated time for test: ${timeToCheck.toISOString()}`);
    }

    const currentHour = timeToCheck.getHours();
    const currentMinutes = timeToCheck.getMinutes();
    const shifts = workingModes[workingModeValue].shifts;
    
    // Find which shift we should be in now OR the next shift if we're near the end
    let currentShiftConfig = null;
    let isNearCurrentShiftEnd = false;
    
    // First, find the current shift
    for (const shift of shifts) {
        if (shift.crossesMidnight) {
            if ((currentHour >= shift.start) || (currentHour < shift.end)) {
                currentShiftConfig = shift;
                break;
            }
        } else {
            if ((currentHour >= shift.start) && (currentHour < shift.end)) {
                currentShiftConfig = shift;
                
                // Check if we're near the end of this shift
                if (currentHour === (shift.end - 1) && currentMinutes >= 55) {
                    isNearCurrentShiftEnd = true;
                }
                break;
            }
        }
    }
    
    // If we're near the end of current shift, find the next shift
    if (isNearCurrentShiftEnd && currentShiftConfig) {
        console.log(`[DEBUG updateTimePeriod] Near end of shift ${currentShiftConfig.name}, looking for next shift...`);
        
        // Find the next shift
        const currentShiftIndex = shifts.indexOf(currentShiftConfig);
        const nextShiftIndex = (currentShiftIndex + 1) % shifts.length;
        const nextShift = shifts[nextShiftIndex];
        
        console.log(`[DEBUG updateTimePeriod] Next shift found: ${nextShift.name}`);
        currentShiftConfig = nextShift;
        
        // Update the preset to the new shift
        timePresetValue = nextShift.id;
    }
    
    console.log(`[DEBUG updateTimePeriod] Time to check: ${timeToCheck.toISOString()}, Hour: ${currentHour}, Found shift: ${currentShiftConfig?.name || 'None'}, Current preset: ${timePresetValue}, Near end: ${isNearCurrentShiftEnd}`);
    
    if (!currentShiftConfig) {
        console.log(`[DEBUG updateTimePeriod] No active shift found for hour ${currentHour} - returning`);
        return; // No active shift found
    }
    
    // Calculate new start time
    const newStartTime = getShiftStartTime(currentShiftConfig, timeToCheck);
    
    console.log(`[DEBUG updateTimePeriod] Current startTime: ${startTime.toISOString()}`);
    console.log(`[DEBUG updateTimePeriod] Calculated newStartTime: ${newStartTime.toISOString()}`);
    console.log(`[DEBUG updateTimePeriod] Times different? ${newStartTime.getTime() !== startTime.getTime()}`);
    
    // Only update if the new start time is different
    if (newStartTime && newStartTime.getTime() !== startTime.getTime()) {
        startTime = newStartTime;
        endTime = timeToCheck; // Use the time we're checking against, not always 'now'
        
        // Close existing WebSocket connections to restart with new time parameters
        for (const unitName in unitSockets) {
            if (unitSockets[unitName]) {
                console.log(`Closing WebSocket connection for "${unitName}" due to shift change`);
                unitSockets[unitName].close();
                delete unitSockets[unitName];
            }
        }
        
        // Clear existing unit containers to force recreation
        unitContainers = {};
        
        // Reload data with new time period
        loadHourlyData();
        console.log('Hourly view: Time period updated automatically:', formatDateForDisplay(startTime), 'to', formatDateForDisplay(endTime));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Update current time every second
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
    
    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    
    // Get units
    selectedUnits = params.getAll('units');
    
    // Get time parameters
    const startParam = params.get('start');
    const endParam = params.get('end');
    timePresetValue = params.get('preset') || '';
    workingModeValue = params.get('workingMode') || 'mode1'; // Default to mode1 if not specified
    
    if (startParam) {
        startTime = new Date(startParam);
    }
    
    if (endParam) {
        endTime = new Date(endParam);
    }
    
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
    
    // Set up periodic checks for new time periods
    setInterval(() => {
        if (checkForNewTimePeriod()) {
            console.log('Hourly view: Shift change detected, updating time period...');
            updateTimePeriod();
        } else {
            // Debug: Log why no shift change was detected
            const now = new Date();
            const currentHour = now.getHours();
            const shifts = workingModes[workingModeValue].shifts;
            const currentShiftConfig = shifts.find(s => s.id === timePresetValue);
            console.log(`[DEBUG] No shift change needed. Current hour: ${currentHour}, Current preset: ${timePresetValue}, Expected shift: ${currentShiftConfig?.name || 'Unknown'}`);
        }
    }, 60000); // Check every minute
    
    // Clean up WebSocket connections when page unloads
    window.addEventListener('beforeunload', () => {
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
        lastUpdateDisplay.innerHTML = `Son güncelleme: ${hours}:${minutes}:${seconds}`;
        
        // Flash effect to indicate update
        lastUpdateDisplay.classList.add('bg-green-600');
        setTimeout(() => {
            lastUpdateDisplay.classList.remove('bg-green-600');
            lastUpdateDisplay.classList.add('bg-gray-800');
        }, 1000);
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
    
    // Column 2: Performance instead of OEE
    const col2 = document.createElement('td');
    col2.className = 'p-0';
    col2.style.width = '50%';
    
    const col2Header = document.createElement('div');
    col2Header.className = 'text-white text-7xl font-bold text-center p-2';
    col2Header.style.backgroundColor = '#7F1D1D'; // bg-red-900
    col2Header.textContent = 'OEE (%)';
    
    const col2Value = document.createElement('div');
    col2Value.id = `performance-value-${unitName.replace(/\s+/g, '-')}`;
    col2Value.className = 'text-9xl font-bold text-center p-2';
    col2Value.style.backgroundColor = '#BBF7D0'; // bg-green-200
    
    // Update Performance value from data summary (not from hourly data)
    let performanceValue = '-';
    if (data.total_performance !== null && data.total_performance !== undefined && data.total_performance > 0) {
        performanceValue = `${(data.total_performance * 100).toFixed(2)}`;
    }
    col2Value.textContent = performanceValue;
    
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
        'Saat', 'Üretim', 'Tamir', 'OEE (%)'
    ];
    
    headers.forEach(headerText => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.className = 'px-2 py-2 text-center font-bold text-black text-4xl tracking-wider';
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
        performanceValue: col2Value,
        tableBody: tableBody,
        lastData: JSON.parse(JSON.stringify(data)) // Store initial data for comparison
    };
    
    console.log(`Created display for "${unitName}"`);
}

// Update an existing hourly data display for a unit
function updateHourlyDataDisplay(unitName, data) {
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
    
    // Update Performance value from data summary (not from hourly data)
    let performanceValue = '-';
    if (data.total_performance !== null && data.total_performance !== undefined && data.total_performance > 0) {
        performanceValue = `${(data.total_performance * 100).toFixed(2)}`;
    }
    container.performanceValue.textContent = performanceValue;
    
    // Update table body with the latest hourly data
    updateTableBody(container.tableBody, data.hourly_data);
    
    // Add a flash effect to the updated values
    container.productionValue.classList.add('flash-update');
    container.performanceValue.classList.add('flash-update');
    
    // Remove flash effect after animation
    setTimeout(() => {
        container.productionValue.classList.remove('flash-update');
        container.performanceValue.classList.remove('flash-update');
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
        successCell.className = 'px-2 py-2 text-center text-black font-bold text-4xl';
        successCell.id = `success-${hour._startDate.getHours()}`;
        successCell.textContent = successQty.toLocaleString();
        row.appendChild(successCell);
        
        // Fail quantity (Repair)
        const failQty = hour.fail_qty || 0;
        const failCell = document.createElement('td');
        failCell.className = 'px-2 py-2 text-center text-red-900 font-bold text-4xl ';
        failCell.id = `fail-${hour._startDate.getHours()}`;
        failCell.textContent = failQty.toLocaleString();
        row.appendChild(failCell);
        
        // Performance
        const performanceCell = document.createElement('td');
        performanceCell.className = 'px-2 py-2 text-center text-black font-bold text-4xl';
        performanceCell.id = `performance-${hour._startDate.getHours()}`;
        // Handle null/zero values explicitly
        if (hour.performance === null || hour.performance === undefined || hour.performance === 0) {
            performanceCell.textContent = '-';
        } else {
            performanceCell.textContent = `${(hour.performance * 100).toFixed(2)}`;
        }
        row.appendChild(performanceCell);
        
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
        if (unitSocket.readyState === WebSocket.OPEN) {
            // Show the updating indicator
            showUpdatingIndicator();
            
            // Use the current global start time but respect shift end time boundaries
            // For live data, we use current time as end time, but this respects the shift logic
            const currentTime = new Date();
            
            // Send parameters to request new data
            const params = {
                start_time: startTime.toISOString(), // This will use the updated startTime if shift changed
                end_time: currentTime.toISOString(), // Always use current time for hourly updates to get latest data
                working_mode: workingModeValue || 'mode1' // Include working mode for break calculations
            };
            
            console.log(`Requesting updated hourly data for "${unitName}" with start time: ${startTime.toISOString()}, end time: ${currentTime.toISOString()}`);
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
        
        // Set up interval to request data every 30 seconds
        updateInterval = setInterval(sendDataRequest, 30000);
    };
    
    unitSocket.onmessage = (event) => {
        try {
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
                        console.log(`${startTime.getHours()}:00-${endTime.getHours()}:00: Success=${hour.success_qty}, Fail=${hour.fail_qty}, Quality=${hour.quality !== null && hour.quality !== undefined ? (hour.quality * 100).toFixed(2) : 'N/A'}%`);
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
                            quality: currentHour.quality !== null && currentHour.quality !== undefined ? (currentHour.quality * 100).toFixed(2) + '%' : 'N/A',
                            performance: currentHour.performance !== null && currentHour.performance !== undefined ? (currentHour.performance * 100).toFixed(2) + '%' : 'N/A',
                            oee: currentHour.oee !== null && currentHour.oee !== undefined ? (currentHour.oee * 100).toFixed(2) + '%' : 'N/A'
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
        
        // Clear the update interval if there's an error
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        
        // Count as completed but with no data
        callback(null);
    };
    
    unitSocket.onclose = (event) => {
        console.log(`Hourly WebSocket closed for ${unitName}:`, event);
        
        // Clear the update interval if the socket is closed
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        
        if (!event.wasClean && reconnectAttempts < maxReconnectAttempts) {
            console.log(`Attempting to reconnect for ${unitName}, attempt ${reconnectAttempts + 1}/${maxReconnectAttempts}`);
            reconnectAttempts++;
            setTimeout(() => {
                connectHourlyWebSocket(unitName, startTime, endTime, callback);
            }, 1000 * reconnectAttempts); // Increase delay with each attempt
        } else if (!event.wasClean && reconnectAttempts >= maxReconnectAttempts) {
            console.error(`Failed to connect to WebSocket for ${unitName} after ${maxReconnectAttempts} attempts`);
            alert(`Failed to connect to ${unitName}. Please try again later.`);
            callback(null);
        }
    };
}