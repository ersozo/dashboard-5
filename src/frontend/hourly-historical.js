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

document.addEventListener('DOMContentLoaded', () => {
    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);

    // Get units
    selectedUnits = params.getAll('units');

    // Get time parameters
    const startParam = params.get('start');
    const endParam = params.get('end');
    timePresetValue = params.get('preset') || '';
    workingModeValue = params.get('workingMode') || 'mode1'; // Default to mode1 if not specified

    console.log('=== HISTORICAL HOURLY VIEW URL PARAMETER DEBUG ===');
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

    console.log('=== END HISTORICAL HOURLY URL PARSING DEBUG ===');

    // If no valid parameters, redirect back to home
    if (selectedUnits.length === 0 || !startTime || !endTime) {
        alert('Missing required parameters. Redirecting to dashboard.');
        window.location.href = '/';
        return;
    }

    // Create last update display
    createLastUpdateDisplay();

    // Load data for each unit (historical - no updates)
    loadHistoricalHourlyData();
});

// Create last update display for historical data
function createLastUpdateDisplay() {
    lastUpdateDisplay = document.createElement('div');
    lastUpdateDisplay.className = 'fixed top-4 right-4 bg-gray-600 text-white px-4 py-2 rounded-lg shadow-lg opacity-80 z-50';

    // Show the time range for historical data
    const startStr = startTime.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    const endStr = endTime.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    lastUpdateDisplay.innerHTML = `📊 Geçmiş Veri: ${startStr} - ${endStr}`;
    document.body.appendChild(lastUpdateDisplay);
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

// Load historical hourly data for all units (no updates)
function loadHistoricalHourlyData() {
    // Show loading indicator
    loadingIndicator.classList.remove('hidden');

    // Clear hourly data container
    hourlyDataContainer.innerHTML = '';

    // Set the grid layout based on number of units
    if (selectedUnits.length === 1) {
        // One unit - single column layout
        hourlyDataContainer.className = 'grid grid-cols-1 gap-4 w-full';
    } else {
        // Multiple units - two column layout
        hourlyDataContainer.className = 'grid grid-cols-1 md:grid-cols-2 gap-4 w-full';
    }

    // Create connections for each selected unit (historical - single request only)
    let completedRequests = 0;

    selectedUnits.forEach(unit => {
        // Connect to WebSocket for historical hourly data (single request)
        connectHistoricalHourlyWebSocket(unit, startTime, endTime, (data) => {
            // Process data for this unit
            createHourlyDataDisplay(unit, data);

            // Track completed requests for initial loading
            completedRequests++;

            // When all initial requests are done, hide loading
            if (completedRequests === selectedUnits.length) {
                // Hide loading indicator
                loadingIndicator.classList.add('hidden');
            }
        });
    });
}

// Connect to WebSocket for historical hourly data (single request, no updates)
function connectHistoricalHourlyWebSocket(unitName, startTime, endTime, callback) {
    // Determine WebSocket URL
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/hourly/${unitName}`;

    console.log(`[HISTORICAL] Connecting to hourly WebSocket for "${unitName}" at ${wsUrl}`);

    // Create a new WebSocket for this unit
    const unitSocket = new WebSocket(wsUrl);

    let hasReceivedData = false;

    // Set a timeout to ensure we get a callback even if WebSocket fails to connect
    const connectionTimeout = setTimeout(() => {
        if (!hasReceivedData) {
            console.warn(`[HISTORICAL] Connection timeout for hourly data "${unitName}". Completing with empty data.`);
            hasReceivedData = true;
            callback(null);
        }
    }, 15000); // 15 second timeout for hourly data

    unitSocket.onopen = () => {
        console.log(`[HISTORICAL] Hourly WebSocket connection established for "${unitName}"`);

        // Send historical data request (no updates)
        const params = {
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            working_mode: workingModeValue || 'mode1'
        };

        console.log(`[HISTORICAL] Requesting historical data for "${unitName}":`, {
            start: params.start_time,
            end: params.end_time,
            working_mode: params.working_mode
        });

        unitSocket.send(JSON.stringify(params));
    };

    unitSocket.onmessage = (event) => {
        try {
            console.log(`[HISTORICAL] Received hourly data message for "${unitName}" (length: ${event.data.length})`);

            // Validate raw data first
            if (!event.data) {
                console.error(`[HISTORICAL] Empty data received for "${unitName}"`);
                if (!hasReceivedData) {
                    hasReceivedData = true;
                    clearTimeout(connectionTimeout);
                    callback(null);
                }
                return;
            }

            // Try to parse the data
            const data = JSON.parse(event.data);

            // Check if response contains an error
            if (data.error) {
                console.error(`[HISTORICAL] Error for hourly data "${unitName}":`, data.error);

                if (!hasReceivedData) {
                    hasReceivedData = true;
                    clearTimeout(connectionTimeout);
                    callback(null);
                }
            } else {
                console.log(`[HISTORICAL] Processed hourly data for "${unitName}": ${data.hourly_data ? data.hourly_data.length : 0} hour records`);

                if (!hasReceivedData) {
                    hasReceivedData = true;
                    clearTimeout(connectionTimeout);
                    callback(data);
                }

                // Close the WebSocket after receiving data (no updates needed for historical)
                unitSocket.close();
            }
        } catch (error) {
            console.error(`[HISTORICAL] Error parsing hourly data for "${unitName}":`, error);
            console.error(`[HISTORICAL] Raw data received: ${event.data.substring(0, 100)}...`);

            if (!hasReceivedData) {
                hasReceivedData = true;
                clearTimeout(connectionTimeout);
                callback(null);
            }
        }
    };

    unitSocket.onerror = (error) => {
        console.error(`[HISTORICAL] Hourly WebSocket error for ${unitName}:`, error);
        callback(null);
    };

    unitSocket.onclose = (event) => {
        console.log(`[HISTORICAL] Hourly WebSocket closed for ${unitName}:`, event);

        if (!event.wasClean && !hasReceivedData) {
            console.error(`[HISTORICAL] Failed to get historical data for ${unitName}`);
            callback(null);
        }
    };
}

// Create hourly data display for a unit (historical - no updates)
function createHourlyDataDisplay(unitName, data) {
    if (!data) {
        console.error(`[HISTORICAL] Invalid data received for "${unitName}"`);
        return;
    }

    if (!data.hourly_data) {
        console.error(`[HISTORICAL] No hourly data received for "${unitName}"`);
        return;
    }

    if (!Array.isArray(data.hourly_data)) {
        console.error(`[HISTORICAL] hourly_data is not an array for "${unitName}"`);
        return;
    }

    console.log(`[HISTORICAL] Processing hourly display for "${unitName}" with ${data.hourly_data.length} records`);
    console.log(`[HISTORICAL] Summary totals: success=${data.total_success}, fail=${data.total_fail}, total=${data.total_qty}`);

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
    col1Value.className = 'text-9xl font-bold text-center p-2';
    col1Value.style.backgroundColor = '#FEF08A'; // bg-yellow-200
    col1Value.textContent = totalSuccessQty.toLocaleString();

    col1.appendChild(col1Header);
    col1.appendChild(col1Value);

    // Column 2: Theoretical Production
    const col2 = document.createElement('td');
    col2.className = 'p-0';
    col2.style.width = '50%';

    const col2Header = document.createElement('div');
    col2Header.className = 'text-white text-7xl font-bold text-center p-2';
    col2Header.style.backgroundColor = '#7F1D1D'; // bg-red-900
    col2Header.textContent = 'HEDEF';

    const col2Value = document.createElement('div');
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
    tableBody.className = 'bg-white divide-y divide-gray-200';

    // Update table body with hourly data
    updateTableBody(tableBody, data.hourly_data);

    table.appendChild(tableBody);
    tableContainer.appendChild(table);
    unitSection.appendChild(tableContainer);

    // Add the unit section to the container
    hourlyDataContainer.appendChild(unitSection);

    console.log(`[HISTORICAL] Created display for "${unitName}"`);
}

// Helper function to update table body with hourly data
function updateTableBody(tableBody, hourlyData) {
    console.log(`[HISTORICAL] Updating table body with ${hourlyData?.length || 0} hourly records`);

    // Clear the table body
    tableBody.innerHTML = '';

    if (!hourlyData || hourlyData.length === 0) {
        // No data case
        const noDataRow = document.createElement('tr');
        const noDataCell = document.createElement('td');
        noDataCell.colSpan = 4;
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
        if (hour.hour_start === undefined || hour.hour_end === undefined) {
            return;
        }

        // Ensure quantity fields are valid numbers
        hour.success_qty = hour.success_qty !== undefined ? Number(hour.success_qty) : 0;
        hour.fail_qty = hour.fail_qty !== undefined ? Number(hour.fail_qty) : 0;
        hour.total_qty = hour.total_qty !== undefined ? Number(hour.total_qty) : 0;

        // Convert ISO strings to Date objects for proper comparison
        try {
            hour._startDate = new Date(hour.hour_start);
            hour._endDate = new Date(hour.hour_end);
        } catch (e) {
            console.error('[HISTORICAL] Error converting dates for hour:', hour, e);
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
        console.warn('[HISTORICAL] No valid hour records found after validation');
        const noDataRow = document.createElement('tr');
        const noDataCell = document.createElement('td');
        noDataCell.colSpan = 4;
        noDataCell.className = 'px-2 py-2 text-center text-gray-500';
        noDataCell.textContent = 'Geçerli veri bulunamadı';
        noDataRow.appendChild(noDataCell);
        tableBody.appendChild(noDataRow);
        return;
    }

    // Sort hours in descending order (newest hour first)
    validHours.sort((a, b) => b._startDate - a._startDate);

    // Add rows for each hour
    validHours.forEach((hour, index) => {
        const row = document.createElement('tr');

        // Add alternating background colors
        row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-200';

        // Hour range
        const hourCell = document.createElement('td');
        hourCell.className = 'px-2 py-2 text-center font-bold text-black text-2xl';
        hourCell.textContent = `${formatTimeOnly(hour._startDate)} - ${formatTimeOnly(hour._endDate)}`;
        row.appendChild(hourCell);

        // Success quantity (Production)
        const successQty = hour.success_qty || 0;
        const successCell = document.createElement('td');
        successCell.className = 'px-2 py-2 text-center text-black font-bold text-7xl';
        successCell.textContent = successQty.toLocaleString();
        row.appendChild(successCell);

        // Fail quantity (Repair)
        const failQty = hour.fail_qty || 0;
        const failCell = document.createElement('td');
        failCell.className = 'px-2 py-2 text-center text-red-900 font-bold text-7xl ';
        failCell.textContent = failQty.toLocaleString();
        row.appendChild(failCell);

        // Theoretical Production
        const theoreticalCell = document.createElement('td');
        theoreticalCell.className = 'px-2 py-2 text-center text-black font-bold text-7xl';
        if (hour.theoretical_qty === null || hour.theoretical_qty === undefined || hour.theoretical_qty === 0) {
            theoreticalCell.textContent = '-';
        } else {
            theoreticalCell.textContent = Math.round(hour.theoretical_qty).toLocaleString();
        }
        row.appendChild(theoreticalCell);

        tableBody.appendChild(row);
    });
}
