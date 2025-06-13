// Global variables
let unitsContainer;
let selectedUnitsDisplay; 
let timeRangeDisplay;
let loadingIndicator;
let summaryContainer;
let totalSuccess;
let totalFail;
let totalQuality;
let totalPerformance;
let lastUpdateTimeElement;

// Parse URL parameters
let selectedUnits = [];
let startTime = null;
let endTime = null;
let timePresetValue = '';
let workingModeValue = 'mode1'; // Default to mode1
// Store unit data containers
let unitData = {};

document.addEventListener('DOMContentLoaded', () => {
    // Initialize DOM references
    unitsContainer = document.getElementById('units-container');
    selectedUnitsDisplay = document.getElementById('selected-units-display');
    timeRangeDisplay = document.getElementById('time-range-display');
    loadingIndicator = document.getElementById('loading-indicator');
    summaryContainer = document.getElementById('summary-container');
    totalSuccess = document.getElementById('total-success');
    totalFail = document.getElementById('total-fail');
    totalQuality = document.getElementById('total-quality');
    totalPerformance = document.getElementById('total-performance');
    lastUpdateTimeElement = document.getElementById('last-update-time');
    
    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    
    // Get units
    selectedUnits = params.getAll('units');
    
    // Get time parameters
    const startParam = params.get('start');
    const endParam = params.get('end');
    timePresetValue = params.get('preset') || '';
    workingModeValue = params.get('workingMode') || 'mode1';
    
    console.log('=== HISTORICAL STANDARD VIEW URL PARAMETER DEBUG ===');
    console.log('Full URL:', window.location.href);
    console.log('Selected units:', selectedUnits);
    console.log('Time preset value:', timePresetValue);
    console.log('Working mode value:', workingModeValue);
    
    if (startParam) {
        startTime = new Date(startParam);
        console.log('Parsed start time:', startTime.toISOString());
    }
    
    if (endParam) {
        endTime = new Date(endParam);
        console.log('Parsed end time:', endTime.toISOString());
    }
    
    console.log('=== END HISTORICAL STANDARD URL PARSING DEBUG ===');
    
    // Validate parameters
    if (selectedUnits.length === 0 || !startTime || !endTime) {
        alert('Missing required parameters. Redirecting to dashboard.');
        window.location.href = '/';
        return;
    }
    
    // Update UI displays
    updateSelectedUnitsDisplay();
    updateTimeDisplay();
    
    // Set historical indicator
    if (lastUpdateTimeElement) {
        const startStr = formatDateForDisplay(startTime);
        const endStr = formatDateForDisplay(endTime);
        lastUpdateTimeElement.textContent = `📊 Geçmiş Veri: ${startStr} - ${endStr}`;
    }
    
    // Load historical data (single request, no updates)
    loadHistoricalData();
});

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

// Update selected units display
function updateSelectedUnitsDisplay() {
    selectedUnitsDisplay.innerHTML = '';
    
    selectedUnits.forEach(unit => {
        const tag = document.createElement('span');
        tag.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800';
        tag.textContent = unit;
        selectedUnitsDisplay.appendChild(tag);
    });
}

// Update time display
function updateTimeDisplay() {
    if (startTime && endTime) {
        timeRangeDisplay.textContent = `${formatDateForDisplay(startTime)} - ${formatDateForDisplay(endTime)}`;
    }
}

// Load historical data for all units (single request)
function loadHistoricalData() {
    console.log('[HISTORICAL] Loading data for units:', selectedUnits);
    
    // Show loading indicator
    loadingIndicator.classList.remove('hidden');
    
    let completedRequests = 0;
    const totalRequests = selectedUnits.length;
    
    selectedUnits.forEach(unitName => {
        fetchHistoricalData(unitName, startTime, endTime, (data) => {
            if (data) {
                if (data.models && Array.isArray(data.models)) {
                    unitData[unitName] = data.models;
                    console.log(`[HISTORICAL] Received data for "${unitName}": ${data.models.length} records`);
                } else if (Array.isArray(data)) {
                    unitData[unitName] = data;
                    console.log(`[HISTORICAL] Received data for "${unitName}": ${data.length} records`);
                } else {
                    console.log(`[HISTORICAL] Unexpected data structure for "${unitName}":`, data);
                    unitData[unitName] = [];
                }
            } else {
                console.log(`[HISTORICAL] No data received for "${unitName}"`);
                unitData[unitName] = [];
            }
            completedRequests++;
            if (completedRequests === totalRequests) {
                console.log('[HISTORICAL] All data loaded, updating UI');
                updateUI();
                loadingIndicator.classList.add('hidden');
            }
        });
    });
}

// Fetch historical data using HTTP endpoint
function fetchHistoricalData(unitName, startTime, endTime, callback) {
    const url = new URL(`/historical-data/${encodeURIComponent(unitName)}`, window.location.origin);
    url.searchParams.append('start_time', startTime.toISOString());
    url.searchParams.append('end_time', endTime.toISOString());
    url.searchParams.append('working_mode', workingModeValue || 'mode1');
    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => callback(data))
        .catch(error => {
            console.error(`[HISTORICAL] Error fetching data for "${unitName}":`, error);
            callback(null);
        });
}

// Update UI with historical data
function updateUI() {
    console.log('[HISTORICAL] Updating UI with data');
    console.log('[HISTORICAL] unitData:', unitData);
    console.log('[HISTORICAL] unitData keys:', Object.keys(unitData));
    Object.keys(unitData).forEach(unit => {
        console.log(`[HISTORICAL] ${unit} has ${unitData[unit] ? unitData[unit].length : 0} records`);
    });
    
    // Update summary
    updateSummary();
    
    // Create unit tables
    createUnitTables(unitData);
    
    // Show summary container
    summaryContainer.classList.remove('hidden');
    
    console.log('[HISTORICAL] UI update complete');
}

// Update summary statistics
function updateSummary() {
    let totalSuccessSum = 0;
    let totalFailSum = 0;
    let totalQualitySum = 0;
    let totalOEESum = 0;
    let unitsWithQuality = 0;
    let unitsWithOEE = 0;
    
    Object.values(unitData).forEach(data => {
        if (data && Array.isArray(data)) {
            data.forEach((row, index) => {
                // Debug first row to see data structure
                if (index === 0) {
                    console.log('[HISTORICAL] Sample row data:', row);
                    console.log('[HISTORICAL] Row fields:', Object.keys(row));
                }
                
                totalSuccessSum += row.success_qty || 0;
                totalFailSum += row.fail_qty || 0;
                
                if (row.quality !== null && row.quality !== undefined) {
                    totalQualitySum += row.quality;
                    unitsWithQuality++;
                }
                
                if (row.performance !== null && row.performance !== undefined) {
                    totalOEESum += row.performance;
                    unitsWithOEE++;
                }
            });
        }
    });
    
    // Update summary display
    totalSuccess.textContent = totalSuccessSum.toLocaleString();
    totalFail.textContent = totalFailSum.toLocaleString();
    
    if (unitsWithQuality > 0) {
        const avgQuality = (totalQualitySum / unitsWithQuality) * 100;
        totalQuality.textContent = `${avgQuality.toFixed(1)}%`;
    } else {
        totalQuality.textContent = 'N/A';
    }
    
    if (unitsWithOEE > 0) {
        const avgOEE = (totalOEESum / unitsWithOEE) * 100;
        totalPerformance.textContent = `${avgOEE.toFixed(1)}%`;
    } else {
        totalPerformance.textContent = 'N/A';
    }
    
    console.log('[HISTORICAL] Summary updated:', {
        success: totalSuccessSum,
        fail: totalFailSum,
        quality: unitsWithQuality > 0 ? (totalQualitySum / unitsWithQuality * 100).toFixed(1) + '%' : 'N/A',
        performance: unitsWithOEE > 0 ? (totalOEESum / unitsWithOEE * 100).toFixed(1) + '%' : 'N/A'
    });
}

// Create unit tables
function createUnitTables(unitDataMap) {
    console.log('[HISTORICAL] createUnitTables called with:', unitDataMap);
    unitsContainer.innerHTML = '';
    
    if (Object.keys(unitDataMap).length === 0) {
        console.log('[HISTORICAL] No units to display');
        const noDataMessage = document.createElement('div');
        noDataMessage.className = 'bg-yellow-100 p-4 rounded-lg border border-yellow-300 text-yellow-800';
        noDataMessage.textContent = 'Seçilen zaman aralığında veri bulunamadı.';
        unitsContainer.appendChild(noDataMessage);
        return;
    }
    
    Object.entries(unitDataMap).forEach(([unitName, data]) => {
        console.log(`[HISTORICAL] Creating section for ${unitName} with data:`, data);
        const unitSection = createUnitSection(unitName, data);
        unitsContainer.appendChild(unitSection);
    });
}

// Create a section for a single unit
function createUnitSection(unitName, data) {
    const section = document.createElement('div');
    section.className = 'bg-white rounded-lg shadow p-6 mb-8'; // Added margin-bottom to match live version
    
    // Unit header with name and stats (same as live version)
    const unitHeader = document.createElement('div');
    unitHeader.className = 'mb-4';
    
    const headerContent = document.createElement('div');
    headerContent.className = 'flex justify-between items-center';
    
    // Create unit title
    const unitTitle = document.createElement('h2');
    unitTitle.className = 'text-xl font-semibold text-gray-800';
    unitTitle.textContent = unitName;
    headerContent.appendChild(unitTitle);
    
    // Create unit success count
    const successCount = document.createElement('div');
    successCount.className = 'text-lg font-medium text-green-600 bg-green-50 px-3 py-1 rounded-lg';
    const totalSuccess = data.reduce((sum, model) => sum + (model.success_qty || 0), 0);
    successCount.textContent = `OK: ${totalSuccess}`;
    headerContent.appendChild(successCount);
    
    unitHeader.appendChild(headerContent);
    section.appendChild(unitHeader);
    
    if (!data || !Array.isArray(data) || data.length === 0) {
        const noDataMessage = document.createElement('p');
        noDataMessage.className = 'text-gray-500 text-center py-8';
        noDataMessage.textContent = 'Bu birim için veri bulunamadı';
        section.appendChild(noDataMessage);
        return section;
    }
    
    // Create table
    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200';
    
    // Create table header
    const thead = document.createElement('thead');
    thead.className = 'bg-gray-50';
    
    const headerRow = document.createElement('tr');
    const headers = ['Model', 'Hedef', 'OK', 'Tamir', 'Kalite (%)', 'OEE (%)'];
    
    headers.forEach(headerText => {
        const th = document.createElement('th');
        th.className = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
        th.textContent = headerText;
        headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Table body
    const tbody = document.createElement('tbody');
    tbody.className = 'bg-white divide-y divide-gray-200';
    
    data.forEach((row, index) => {
        // Debug each row for performance field
        if (index === 0) {
            console.log(`[HISTORICAL] Creating table for unit "${unitName}", first row:`, row);
            console.log(`[HISTORICAL] Row has performance field?`, 'performance' in row);
            console.log(`[HISTORICAL] Row performance value:`, row.performance);
        }
        
        const tr = document.createElement('tr');
        tr.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        
        // Model
        const modelTd = document.createElement('td');
        modelTd.className = 'px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900';
        modelTd.textContent = row.model || 'N/A';
        tr.appendChild(modelTd);
        
        // Target (Hedef)
        const targetTd = document.createElement('td');
        targetTd.className = 'px-6 py-4 whitespace-nowrap text-sm text-blue-600';
        targetTd.textContent = row.target || '-';
        tr.appendChild(targetTd);
        
        // Success (OK)
        const successTd = document.createElement('td');
        successTd.className = 'px-6 py-4 whitespace-nowrap text-sm text-green-600';
        successTd.textContent = (row.success_qty || 0).toLocaleString();
        tr.appendChild(successTd);
        
        // Fail (Tamir)
        const failTd = document.createElement('td');
        failTd.className = 'px-6 py-4 whitespace-nowrap text-sm text-red-600';
        failTd.textContent = (row.fail_qty || 0).toLocaleString();
        tr.appendChild(failTd);
        
        // Quality
        const qualityTd = document.createElement('td');
        qualityTd.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
        const totalProcessed = (row.success_qty || 0) + (row.fail_qty || 0);
        const modelQuality = totalProcessed > 0 ? (row.success_qty || 0) / totalProcessed : 0;
        const quality = (modelQuality * 100).toFixed(0);
        qualityTd.textContent = quality;
        tr.appendChild(qualityTd);
        
        // OEE (Performance)
        const performanceTd = document.createElement('td');
        performanceTd.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
        const performance = (row.performance !== undefined && row.performance !== null) 
            ? (row.performance * 100).toFixed(2) 
            : '-';
        performanceTd.textContent = performance;
        tr.appendChild(performanceTd);
        
        tbody.appendChild(tr);
    });
    
    table.appendChild(tbody);
    section.appendChild(table);
    
    return section;
} 