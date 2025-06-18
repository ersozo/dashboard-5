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
let updateIndicator;
let lastUpdateTimeElement;

// Parse URL parameters
let selectedUnits = [];
let startTime = null;
let endTime = null;
let timePresetValue = '';
let workingModeValue = 'mode1'; // Default to mode1
// Store WebSocket connections for each unit
let unitSockets = {};
// Store unit data containers to update them
let unitData = {};
// Track if all connections are established
let allConnectionsEstablished = false;
// Track last update timestamp
let lastUpdateTime = null;
// Store elements that need to flash on update
let elementsToFlashOnUpdate = [];
// Flag to prevent old WebSocket data processing during shift changes
let isShiftChangeInProgress = false;

// Background tab handling variables
let isTabVisible = true;
let lastVisibilityChange = Date.now();
let visibilityCheckInterval = null;
let shiftCheckInterval = null;

// Working mode configurations (same as in app.js and hourly.js)
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

// This is the LIVE data view - always treat data as live (no historical detection needed)

// Function to check if we need to update to a new time period
function checkForNewTimePeriod() {
    if (!timePresetValue || !startTime || !endTime || !workingModeValue) return false;

    // LIVE data view - always check for shift changes
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
    
    // Update the time display
    updateTimeDisplay();
    
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
    
    // Clear existing unit data
    unitData = {};
    allConnectionsEstablished = false;
    
    // Clear existing tables to force recreation with fresh data
    unitsContainer.innerHTML = '';
    
    // Reset summary display
    summaryContainer.classList.add('hidden');
    totalSuccess.textContent = '-';
    totalFail.textContent = '-';
    totalQuality.textContent = '-';
    totalPerformance.textContent = '-';
    
    // Clear elements to flash array
    elementsToFlashOnUpdate = [];
    
    // Reload data with new time period
    console.log('[SHIFT CHANGE] Reloading data for new shift...');
    loadData();
    
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
    
    // Start optimized intervals
    startOptimizedIntervals();
    
    // Initialize all DOM elements
    unitsContainer = document.getElementById('units-container');
    selectedUnitsDisplay = document.getElementById('selected-units-display');
    timeRangeDisplay = document.getElementById('time-range-display');
    loadingIndicator = document.getElementById('loading-indicator');
    summaryContainer = document.getElementById('summary-container');
    totalSuccess = document.getElementById('total-success');
    totalFail = document.getElementById('total-fail');
    totalQuality = document.getElementById('total-quality');
    totalPerformance = document.getElementById('total-performance');
    updateIndicator = document.getElementById('update-indicator');
    lastUpdateTimeElement = document.getElementById('last-update-time');
    
    // Check if all required DOM elements exist
    if (!unitsContainer) console.error("Missing element: unitsContainer");
    if (!selectedUnitsDisplay) console.error("Missing element: selectedUnitsDisplay");
    if (!timeRangeDisplay) console.error("Missing element: timeRangeDisplay");
    if (!loadingIndicator) console.error("Missing element: loadingIndicator");
    if (!summaryContainer) console.error("Missing element: summaryContainer");
    if (!totalSuccess) console.error("Missing element: totalSuccess");
    if (!totalFail) console.error("Missing element: totalFail");
    if (!totalQuality) console.error("Missing element: totalQuality");
    if (!totalPerformance) console.error("Missing element: totalPerformance");
    if (!updateIndicator) console.error("Missing element: updateIndicator");
    if (!lastUpdateTimeElement) console.error("Missing element: lastUpdateTimeElement");
    
    if (!lastUpdateTimeElement || !updateIndicator || !unitsContainer) {
        console.error('Could not find necessary DOM elements');
        alert('There was a problem initializing the dashboard. Please refresh the page.');
        return;
    }

    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    
    // Get units
    selectedUnits = params.getAll('units');
    
    // Get time parameters
    const startParam = params.get('start');
    const endParam = params.get('end');
    timePresetValue = params.get('preset') || '';
    workingModeValue = params.get('workingMode') || 'mode1'; // Default to mode1 if not specified
    
    console.log('=== URL PARAMETER PARSING DEBUG ===');
    console.log('All URL params:', params.toString());
    console.log('Start param (raw):', startParam);
    console.log('End param (raw):', endParam);
    console.log('Selected units:', selectedUnits);
    console.log('Time preset value:', timePresetValue);
    console.log('Working mode value:', workingModeValue);
    
    if (startParam) {
        startTime = new Date(startParam);
        console.log('Parsed start time:', startTime);
        console.log('Start time is valid?:', !isNaN(startTime.getTime()));
    }
    
    if (endParam) {
        endTime = new Date(endParam);
        console.log('Parsed end time:', endTime);
        console.log('End time is valid?:', !isNaN(endTime.getTime()));
    }
    
    console.log('=== END URL PARSING DEBUG ===');
    
    // If no valid parameters, redirect back to home
    if (selectedUnits.length === 0 || !startTime || !endTime) {
        alert('Eksik parametreler var. Ana sayfaya yönlendiriyoruz.');
        window.location.href = '/';
        return;
    }
    
    // Create last update display
    createLastUpdateDisplay();
    
    // Update UI with selected units
    updateSelectedUnitsDisplay();
    
    // Update time range display
    updateTimeDisplay();
    
    // Load data for each unit
    loadData();
    
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
    // Initialize the update timestamp
    lastUpdateTime = new Date();
    
    // Set initial update time display
    const hours = String(lastUpdateTime.getHours()).padStart(2, '0');
    const minutes = String(lastUpdateTime.getMinutes()).padStart(2, '0');
    const seconds = String(lastUpdateTime.getSeconds()).padStart(2, '0');
    lastUpdateTimeElement.textContent = `Last update: ${hours}:${minutes}:${seconds}`;
}

// Show update in progress indicator
function showUpdatingIndicator() {
    // Show updating indicator if it exists
    if (updateIndicator) {
        updateIndicator.classList.remove('hidden');
    }
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

// Update UI with selected units
function updateSelectedUnitsDisplay() {
    selectedUnitsDisplay.innerHTML = '';
    
    selectedUnits.forEach(unit => {
        const tag = document.createElement('span');
        tag.className = 'bg-blue-100 text-blue-800 px-3 py-1 rounded text-sm font-medium';
        tag.textContent = unit;
        selectedUnitsDisplay.appendChild(tag);
    });
}

// Update time range display
function updateTimeDisplay() {
    let timeRangeText = `${formatDateForDisplay(startTime)} - ${formatDateForDisplay(endTime)}`;
    
    // LIVE data view - no historical detection needed
    
    // Add preset name if available
    if (timePresetValue && workingModeValue) {
        const shifts = workingModes[workingModeValue].shifts;
        const shiftConfig = shifts.find(s => s.id === timePresetValue);
        
        if (shiftConfig) {
            const workingModeName = workingModes[workingModeValue].name;
            const presetName = `${workingModeName} - Vardiya: ${shiftConfig.name}`;
            timeRangeText = `${presetName}: ${timeRangeText}`;
        } else {
            // Fallback for legacy shift names
            let presetName = '';
            switch(timePresetValue) {
                case 'shift1':
                    presetName = 'Vardiya 1';
                    break;
                case 'shift2':
                    presetName = 'Vardiya 2';
                    break;
                case 'shift3':
                    presetName = 'Vardiya 3';
                    break;
                case 'today':
                    presetName = 'Bugün';
                    break;
            }
            
            if (presetName) {
                timeRangeText = `${presetName}: ${timeRangeText}`;
            }
        }
    }
    
    // LIVE data view - always show live indicator
    const realTimeIndicator = document.getElementById('real-time-indicator');
    if (realTimeIndicator) {
        realTimeIndicator.className = 'flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium';
        realTimeIndicator.innerHTML = `
            <span class="h-2 w-2 mr-2 rounded-full bg-green-500 animate-pulse"></span>
            Canlı
        `;
    }
    
    // Always show live data indicator
    timeRangeText = `🟢 Canlı Veri: ${timeRangeText}`;
    
    // Reset style for live data
    if (timeRangeDisplay) {
        timeRangeDisplay.style.color = '#1F2937'; // Normal dark color
        timeRangeDisplay.style.fontStyle = 'normal';
    }
    
    if (timeRangeDisplay) {
        timeRangeDisplay.textContent = timeRangeText;
    }
}

// Load data for all units
function loadData() {
    // Show loading indicator and hide summary
    loadingIndicator.classList.remove('hidden');
    summaryContainer.classList.add('hidden');
    
    // Clear units container
    unitsContainer.innerHTML = '';
    
    // Reset unit data to empty state
    unitData = {};
    
    // Create connections for each selected unit
    let completedRequests = 0;
    
    // Initialize unit data storage for each unit
    selectedUnits.forEach(unit => {
        // Initialize empty data array for each unit
        unitData[unit] = {};
    });
    
    // Create a separate array to ensure we track units that had data
    let unitsWithData = [];
    
    // If no units selected, show error message
    if (selectedUnits.length === 0) {
        console.error("No units selected");
        loadingIndicator.classList.add('hidden');
        const noUnitsMessage = document.createElement('div');
        noUnitsMessage.className = 'bg-red-100 p-4 rounded-lg border border-red-300 text-red-800';
        noUnitsMessage.textContent = 'No units selected. Please return to the dashboard and select units.';
        unitsContainer.appendChild(noUnitsMessage);
        return;
    }
    
    // Function to check if all requests are completed and update UI
    function checkAllRequestsCompleted() {
        completedRequests++;
        
        console.log(`🔄 CALLBACK DEBUG: Completed requests: ${completedRequests}/${selectedUnits.length}`);
        console.log(`🔄 CALLBACK DEBUG: Selected units:`, selectedUnits);
        console.log(`🔄 CALLBACK DEBUG: Current unitData:`, Object.keys(unitData));
        
        // When all initial requests are done, create UI and hide loading
        if (completedRequests === selectedUnits.length) {
            console.log(`✅ CALLBACK DEBUG: All requests completed, creating UI...`);
            
            // Count units that actually have data
            for (const u in unitData) {
                if (unitData[u] && unitData[u].models && unitData[u].models.length > 0) {
                    unitsWithData.push(u);
                }
            }
            
            console.log(`📊 CALLBACK DEBUG: Units with data:`, unitsWithData);
            console.log(`📊 CALLBACK DEBUG: About to call updateUI()`);
            
            // Update UI with all the data collected so far
            updateUI();
                
            // Hide loading indicator and show results
            loadingIndicator.classList.add('hidden');
            summaryContainer.classList.remove('hidden');
            
            console.log(`✅ CALLBACK DEBUG: UI update completed, loading hidden, summary shown`);
            
            // Update the last update time
            updateLastUpdateTime();
        } else {
            console.log(`⏳ CALLBACK DEBUG: Still waiting for ${selectedUnits.length - completedRequests} more requests`);
        }
    }
    
    // Connect to WebSocket for each unit
    selectedUnits.forEach(unit => {
        console.log(`🚀 WEBSOCKET DEBUG: Connecting to unit: ${unit}`);
        // Connect to WebSocket for this unit
        connectWebSocket(unit, startTime, endTime, (data) => {
            console.log(`📥 WEBSOCKET CALLBACK DEBUG: Received callback for unit: ${unit}`);
            console.log(`📥 WEBSOCKET CALLBACK DEBUG: Data length:`, Array.isArray(data) ? data.length : 'Not array');
            // Check if all requests are completed
            checkAllRequestsCompleted();
        });
    });
}

// Process data for a specific unit
function processUnitData(unit, data) {
    // Ensure unit data array exists
    if (!unitData[unit]) {
        unitData[unit] = {};
    } else {
        // Clear existing data for this unit to prevent duplicates
        unitData[unit] = {};
    }
    
    // Check if data has the new structure with models and summary
    if (data.models && data.summary) {
        // New structure: extract models and store summary separately
        unitData[unit].models = [];
        data.models.forEach(item => {
            // Always ensure item has unit property
            item.unit = unit;
            unitData[unit].models.push(item);
        });
        
        // Store backend-calculated summary
        unitData[unit].summary = data.summary;
    } else {
        // Old structure: assume data is array of models (fallback)
        unitData[unit].models = [];
    data.forEach(item => {
        // Always ensure item has unit property
        item.unit = unit;
            unitData[unit].models.push(item);
    });
        
        // No summary provided - will need to calculate (shouldn't happen with new backend)
        unitData[unit].summary = null;
    }
}

// Update UI with current data
function updateUI() {
    console.log(`🎨 UI DEBUG: updateUI() called`);
    console.log(`🎨 UI DEBUG: isShiftChangeInProgress:`, isShiftChangeInProgress);
    console.log(`🎨 UI DEBUG: unitsContainer.children.length:`, unitsContainer ? unitsContainer.children.length : 'unitsContainer is null');
    console.log(`🎨 UI DEBUG: unitData keys:`, Object.keys(unitData));
    
    // Skip UI updates during shift change to prevent old data from showing
    if (isShiftChangeInProgress) {
        console.log('[SHIFT CHANGE] Skipping UI update during shift change');
        return;
    }
    
    // Update summary first (now uses backend-calculated values)
    console.log(`🎨 UI DEBUG: Calling updateSummary()`);
    updateSummary();
    
    // Check if tables exist - if not, create them
    if (unitsContainer.children.length === 0) {
        console.log(`🎨 UI DEBUG: No existing tables, calling createUnitTables()`);
        createUnitTables(unitData);
    } else {
        console.log(`🎨 UI DEBUG: Tables exist, updating existing tables`);
        // Otherwise update existing tables
        for (const unit in unitData) {
            const models = unitData[unit].models;
            
            if (!models) continue; // Skip if no models data
            
            // Update unit success count
            const successCountElement = document.getElementById(`success-count-${unit.replace(/\s+/g, '-')}`);
            if (successCountElement) {
                const totalSuccess = models.reduce((sum, model) => sum + model.success_qty, 0);
                successCountElement.textContent = `OK: ${totalSuccess}`;
                elementsToFlashOnUpdate.push(successCountElement);
            }
            
            // Update each model row
            models.forEach(model => {
                // Update target qty
                const targetQtyElement = document.getElementById(`target-${unit.replace(/\s+/g, '-')}-${model.model.replace(/\s+/g, '-')}`);
                if (targetQtyElement) {
                    const targetQty = model.target || '-';
                    if (targetQtyElement.textContent != targetQty) {
                        targetQtyElement.textContent = targetQty;
                    }
                }
                
                // Update success qty
                const successQtyElement = document.getElementById(`success-${unit.replace(/\s+/g, '-')}-${model.model.replace(/\s+/g, '-')}`);
                if (successQtyElement && successQtyElement.textContent != model.success_qty) {
                    successQtyElement.textContent = model.success_qty;
                    elementsToFlashOnUpdate.push(successQtyElement);
                }
                
                // Update fail qty
                const failQtyElement = document.getElementById(`fail-${unit.replace(/\s+/g, '-')}-${model.model.replace(/\s+/g, '-')}`);
                if (failQtyElement && failQtyElement.textContent != model.fail_qty) {
                    failQtyElement.textContent = model.fail_qty;
                    elementsToFlashOnUpdate.push(failQtyElement);
                }
                
                // Update quality
                const qualityElement = document.getElementById(`quality-${unit.replace(/\s+/g, '-')}-${model.model.replace(/\s+/g, '-')}`);
                if (qualityElement) {
                    const totalProcessed = model.success_qty + model.fail_qty;
                    const modelQuality = totalProcessed > 0 ? model.success_qty / totalProcessed : 0;
                    const quality = (modelQuality * 100).toFixed(0);
                    if (qualityElement.textContent != quality) {
                        qualityElement.textContent = quality;
                    }
                }
                
                // Update Performance (use backend-calculated value)
                const performanceElement = document.getElementById(`performance-${unit.replace(/\s+/g, '-')}-${model.model.replace(/\s+/g, '-')}`);
                if (performanceElement) {
                    const performance = (model.performance !== undefined && model.performance !== null) 
                        ? (model.performance * 100).toFixed(0) 
                        : '-';
                    if (performanceElement.textContent != performance) {
                        performanceElement.textContent = performance;
                    }
                }
            });
        }
    }
    console.log(`🎨 UI DEBUG: updateUI() completed`);
}

// Create tables for each unit
function createUnitTables(unitDataMap) {
    console.log(`🏗️ TABLE DEBUG: createUnitTables() called`);
    console.log(`🏗️ TABLE DEBUG: unitDataMap keys:`, Object.keys(unitDataMap));
    console.log(`🏗️ TABLE DEBUG: isShiftChangeInProgress:`, isShiftChangeInProgress);
    console.log(`🏗️ TABLE DEBUG: unitsContainer exists?:`, !!unitsContainer);
    
    // Skip table creation during shift change to prevent old data from showing
    if (isShiftChangeInProgress) {
        console.log('[SHIFT CHANGE] Skipping table creation during shift change');
        return;
    }
    
    unitsContainer.innerHTML = '';
    
    let unitCount = 0;
    
    for (const unit in unitDataMap) {
        const models = unitDataMap[unit].models;
        
        console.log(`🏗️ TABLE DEBUG: Processing unit: ${unit}`);
        console.log(`🏗️ TABLE DEBUG: Models for ${unit}:`, models ? models.length : 'No models');
        
        if (!models || models.length === 0) {
            console.log(`🏗️ TABLE DEBUG: Skipping ${unit} - no models`);
            continue;
        }
        
        unitCount++;
        console.log(`🏗️ TABLE DEBUG: Creating table for unit: ${unit} (count: ${unitCount})`);
        
        const unitContainer = document.createElement('div');
        unitContainer.className = 'bg-white rounded-lg shadow p-6 mb-8'; // Added margin-bottom
        unitContainer.id = `unit-${unit.replace(/\s+/g, '-')}`;
        
        // Unit header with name and stats
        const unitHeader = document.createElement('div');
        unitHeader.className = 'mb-4';
        
        const headerContent = document.createElement('div');
        headerContent.className = 'flex justify-between items-center';
        
        // Create unit title
        const unitTitle = document.createElement('h2');
        unitTitle.className = 'text-xl font-semibold text-gray-800';
        unitTitle.textContent = unit;
        headerContent.appendChild(unitTitle);
        
        // Create unit success count - this will update
        const successCount = document.createElement('div');
        successCount.className = 'text-lg font-medium text-green-600 bg-green-50 px-3 py-1 rounded-lg';
        const totalSuccess = models.reduce((sum, model) => sum + model.success_qty, 0);
        successCount.textContent = `OK: ${totalSuccess}`;
        successCount.id = `success-count-${unit.replace(/\s+/g, '-')}`;
        // Add to elements that should flash when updated
        elementsToFlashOnUpdate.push(successCount);
        headerContent.appendChild(successCount);
        
        // Create unit performance sum
        const performanceSum = document.createElement('div');
        performanceSum.className = 'text-lg font-medium text-blue-600 bg-blue-50 px-3 py-1 rounded-lg ml-2';
        
        // Use backend-calculated unit performance sum if available, otherwise calculate from models
        let totalPerformance = 0;
        if (unitDataMap[unit] && unitDataMap[unit].summary && unitDataMap[unit].summary.unit_performance_sum !== undefined) {
            // Use backend-calculated value
            totalPerformance = unitDataMap[unit].summary.unit_performance_sum;
        } else {
            // Fallback: calculate from models
            totalPerformance = models.reduce((sum, model) => {
                return sum + (model.performance !== null && model.performance !== undefined ? model.performance : 0);
            }, 0);
        }
        
        performanceSum.textContent = `OEE: ${(totalPerformance * 100).toFixed(0)}%`;
        performanceSum.id = `performance-sum-${unit.replace(/\s+/g, '-')}`;
        // Add to elements that should flash when updated
        elementsToFlashOnUpdate.push(performanceSum);
        headerContent.appendChild(performanceSum);
        
        unitHeader.appendChild(headerContent);
        unitContainer.appendChild(unitHeader);
        
        // Create the table
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
        
        // Create table body
        const tbody = document.createElement('tbody');
        tbody.className = 'bg-white divide-y divide-gray-200';
        
        console.log(`🏗️ TABLE DEBUG: Creating ${models.length} rows for ${unit}`);
        
        // Add a row for each model
        models.forEach((model, index) => {
                const row = document.createElement('tr');
            row.className = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
            
            // Cell 1: Model Name
            const modelCell = document.createElement('td');
            modelCell.className = 'px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900';
            modelCell.textContent = model.model;
            row.appendChild(modelCell);
            
            // Cell 2: Target Quantity
            const targetCell = document.createElement('td');
            targetCell.className = 'px-6 py-4 whitespace-nowrap text-sm text-blue-600';
            targetCell.id = `target-${unit.replace(/\s+/g, '-')}-${model.model.replace(/\s+/g, '-')}`;
            targetCell.textContent = model.target || '-';
            row.appendChild(targetCell);
            
            // Cell 3: Success Quantity
            const successCell = document.createElement('td');
            successCell.className = 'px-6 py-4 whitespace-nowrap text-sm text-green-600';
            successCell.id = `success-${unit.replace(/\s+/g, '-')}-${model.model.replace(/\s+/g, '-')}`;
            successCell.textContent = model.success_qty;
            // Add to elements that should flash when updated
            elementsToFlashOnUpdate.push(successCell);
            row.appendChild(successCell);
            
            // Cell 4: Fail Quantity
            const failCell = document.createElement('td');
            failCell.className = 'px-6 py-4 whitespace-nowrap text-sm text-red-600';
            failCell.id = `fail-${unit.replace(/\s+/g, '-')}-${model.model.replace(/\s+/g, '-')}`;
            failCell.textContent = model.fail_qty;
            // Add to elements that should flash when updated
            elementsToFlashOnUpdate.push(failCell);
            row.appendChild(failCell);
            
            // Cell 5: Quality
                const qualityCell = document.createElement('td');
            qualityCell.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
            qualityCell.id = `quality-${unit.replace(/\s+/g, '-')}-${model.model.replace(/\s+/g, '-')}`;
            const totalProcessed = model.success_qty + model.fail_qty;
            const modelQuality = totalProcessed > 0 ? model.success_qty / totalProcessed : 0;
            const quality = (modelQuality * 100).toFixed(0);
            qualityCell.textContent = quality;
                row.appendChild(qualityCell);
                
            // Cell 6: Performance
                const performanceCell = document.createElement('td');
            performanceCell.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500';
            performanceCell.id = `performance-${unit.replace(/\s+/g, '-')}-${model.model.replace(/\s+/g, '-')}`;
            const performance = (model.performance !== undefined && model.performance !== null) 
                ? (model.performance * 100).toFixed(1) 
                : '-';
            performanceCell.textContent = performance;
                row.appendChild(performanceCell);
                
            tbody.appendChild(row);
        });
        
        table.appendChild(tbody);
        unitContainer.appendChild(table);
        
        // Add the completed unit table to the container
        unitsContainer.appendChild(unitContainer);
        
        console.log(`🏗️ TABLE DEBUG: Added table for ${unit} to DOM`);
    }
    
    console.log(`🏗️ TABLE DEBUG: Total units created: ${unitCount}`);
    
    // If no units were displayed, show an error message
    if (unitCount === 0) {
        console.log(`🏗️ TABLE DEBUG: No units created, showing error message`);
        const noDataMessage = document.createElement('div');
        noDataMessage.className = 'bg-yellow-100 p-4 rounded-lg border border-yellow-300 text-yellow-800';
        noDataMessage.textContent = 'Bu zaman aralığında seçilen birimler için veri bulunamadı.';
        unitsContainer.appendChild(noDataMessage);
    }
    
    console.log(`🏗️ TABLE DEBUG: createUnitTables() completed`);
}

// Connect to WebSocket and handle data
function connectWebSocket(unitName, startTime, endTime, callback) {
    // Determine WebSocket URL
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/${encodeURIComponent(unitName)}`;
    
    // Create a new WebSocket for this unit
    const unitSocket = new WebSocket(wsUrl);
    
    // Store the socket for cleanup
    unitSockets[unitName] = unitSocket;
    
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 3;
    
    // Set up interval for data refreshing
    let updateInterval = null;
    let hasReceivedInitialData = false;
    
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
        
        // LIVE data view - always update endTime for current data
        const now = new Date();
        const isShiftBasedView = timePresetValue && (timePresetValue.startsWith('shift'));
        if (isShiftBasedView || !hasReceivedInitialData) {
            // Update endTime to maintain live status
            endTime = now;
        }
        
        if (unitSocket.readyState === WebSocket.OPEN) {
            // LIVE data view - always show updating indicator
            showUpdatingIndicator();
            
            // For live data, always use current time
            const requestEndTime = new Date();
            
            // Update endTime to maintain live status
            endTime = requestEndTime;
            
            // Send parameters to request new data
            const params = {
                start_time: startTime.toISOString(),
                end_time: requestEndTime.toISOString(),
                working_mode: workingModeValue || 'mode1' // Include working mode for break calculations
            };
            
            console.log(`[DATA REQUEST] ${unitName}: Live data request`, {
                start: params.start_time,
                end: params.end_time
            });
            
            unitSocket.send(JSON.stringify(params));
        } else {
            console.warn(`Cannot send update request - socket not open for "${unitName}", readyState: ${unitSocket.readyState}`);
            // Clear interval if socket is not open
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }
            
            // If we haven't received initial data and socket is closed, trigger callback with empty data
            if (!hasReceivedInitialData) {
                console.warn(`Socket closed before receiving initial data for "${unitName}". Completing with empty data.`);
                hasReceivedInitialData = true;
                callback([]);
            }
        }
    }
    
    // Set a timeout to ensure we get a callback even if WebSocket fails to connect or is slow
    const connectionTimeout = setTimeout(() => {
        if (!hasReceivedInitialData) {
            console.warn(`Connection timeout for "${unitName}". Completing with empty data.`);
            hasReceivedInitialData = true;
            
            // Ensure we have an entry in unitData even if no data is received
            if (!unitData[unitName]) {
                unitData[unitName] = {};
            }
            
            callback([]);
        }
    }, 10000); // 10 second timeout
    
    unitSocket.onopen = () => {
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
        console.log(`🚀 FRONTEND: WebSocket message received for "${unitName}"`);
        console.log(`🚀 FRONTEND: Event data exists?`, !!event.data);
        console.log(`🚀 FRONTEND: Event data length:`, event.data ? event.data.length : 'undefined');
        
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
            
            console.log(`=== STANDARD VIEW DEBUG: DATA RECEIVED FOR ${unitName} ===`);
            console.log('Raw event data length:', event.data.length);
            console.log('Raw event data preview:', event.data.substring(0, 200));
            
            const data = JSON.parse(event.data);
            
            console.log('Parsed data type:', typeof data);
            console.log('Parsed data structure:');
            console.log('  - has models property?:', data.hasOwnProperty('models'));
            console.log('  - has summary property?:', data.hasOwnProperty('summary'));
            console.log('  - is array?:', Array.isArray(data));
            if (data.models) {
                console.log('  - models length:', data.models.length);
                console.log('  - first model:', data.models[0]);
            }
            if (data.summary) {
                console.log('  - summary:', data.summary);
            }
            
            // Check if response contains an error
            if (data.error) {
                console.error(`Error for "${unitName}":`, data.error);
                
                // Still count as completed for multi-unit processing
                if (!hasReceivedInitialData) {
                    hasReceivedInitialData = true;
                    clearTimeout(connectionTimeout);
                    
                    // Ensure we have an entry in unitData even if there's an error
                    if (!unitData[unitName]) {
                        unitData[unitName] = {};
                    }
                    
                callback([]);
                }
            } else {
                console.log(`STANDARD VIEW: Processing data for "${unitName}"`);
                
                // Process the data - CRITICAL: Must process before calling callback
                processUnitData(unitName, data);
                
                console.log(`STANDARD VIEW: After processing, unitData["${unitName}"] structure:`);
                console.log('  - has models?:', unitData[unitName] && unitData[unitName].models);
                console.log('  - models length:', unitData[unitName] && unitData[unitName].models ? unitData[unitName].models.length : 'No models');
                console.log('  - has summary?:', unitData[unitName] && unitData[unitName].summary);
                
                // Only call the callback once for initial data
                if (!hasReceivedInitialData) {
                    hasReceivedInitialData = true;
                    clearTimeout(connectionTimeout);
                    console.log(`STANDARD VIEW: Calling initial callback for "${unitName}"`);
                    callback(data.models || data);
                } else {
                    // If it's a subsequent update, update UI directly
                    console.log(`STANDARD VIEW: Updating UI for subsequent data for "${unitName}"`);
                    updateUI();
                    updateLastUpdateTime();
                }
            }
            console.log('=== END STANDARD VIEW DEBUG ===');
        } catch (error) {
            console.error(`🚨 FRONTEND ERROR: Error parsing data for "${unitName}":`, error);
            console.error(`🚨 FRONTEND ERROR: Stack trace:`, error.stack);
            
            if (!hasReceivedInitialData) {
                hasReceivedInitialData = true;
                clearTimeout(connectionTimeout);
                
                // Ensure we have an entry in unitData even if there's a parsing error
                if (!unitData[unitName]) {
                    unitData[unitName] = {};
                }
                
            callback([]);
            }
        }
    };
    
    unitSocket.onerror = (error) => {
        console.error(`WebSocket error for "${unitName}":`, error);
        
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
        if (!hasReceivedInitialData) {
            hasReceivedInitialData = true;
            clearTimeout(connectionTimeout);
        callback([]);
        }
    };
    
    unitSocket.onclose = (event) => {
        // Clear the update interval and adaptive interval if the socket is closed
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        if (unitSocket._adaptiveInterval) {
            clearInterval(unitSocket._adaptiveInterval);
            unitSocket._adaptiveInterval = null;
        }
        
        // Make sure we call callback if we haven't received initial data yet
        if (!hasReceivedInitialData) {
            hasReceivedInitialData = true;
            clearTimeout(connectionTimeout);
            callback([]);
            return;
        }
        
        if (!event.wasClean && reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            
            // Use longer reconnect delay if tab is in background to avoid overwhelming the server
            const reconnectDelay = !isTabVisible ? 
                Math.min(30000, 1000 * reconnectAttempts * 3) : // Up to 30s when hidden
                1000 * reconnectAttempts; // Standard delay when visible
                
            console.log(`[RECONNECT] Waiting ${reconnectDelay}ms before reconnect attempt (visible: ${isTabVisible})`);
            
            setTimeout(() => {
                connectWebSocket(unitName, startTime, endTime, (data) => {
                    // Only process data on reconnect, don't call original callback
                    if (data && data.length > 0) {
                        processUnitData(unitName, data);
                        updateUI();
                        updateLastUpdateTime();
                    }
                });
            }, reconnectDelay);
        } else if (!event.wasClean && reconnectAttempts >= maxReconnectAttempts) {
            console.error(`Failed to connect to WebSocket for "${unitName}" after ${maxReconnectAttempts} attempts`);
        }
    };
}

// Update summary with production data
function updateSummary() {
    // Skip summary update during shift change to prevent old data from showing
    if (isShiftChangeInProgress) {
        console.log('[SHIFT CHANGE] Skipping summary update during shift change');
        return;
    }
    
    // Use backend-calculated summary values if available
    let totalSuccessQty = 0;
    let totalFailQty = 0;
    let overallQuality = 0;
    let overallPerformance = 0;
    
    let unitsWithSummary = 0;
    let qualitySum = 0;
    let performanceSum = 0;
    
    // Aggregate backend-calculated summaries from all units
    for (const unit in unitData) {
        if (unitData[unit] && unitData[unit].summary) {
            const summary = unitData[unit].summary;
            
            totalSuccessQty += summary.total_success || 0;
            totalFailQty += summary.total_fail || 0;
            
            // Weight quality and performance by unit's total production
            const unitTotalProcessed = (summary.total_success || 0) + (summary.total_fail || 0);
            if (unitTotalProcessed > 0) {
                qualitySum += (summary.total_quality || 0) * unitTotalProcessed;
            }
            
            // Include performance if valid - weight by unit success for weighted average
            if (summary.total_performance !== null && summary.total_performance !== undefined && (summary.total_success || 0) > 0) {
                performanceSum += (summary.total_performance || 0) * (summary.total_success || 0);
                unitsWithSummary += (summary.total_success || 0);
            }
        }
    }
    
    // Calculate overall metrics
    const totalProcessedAll = totalSuccessQty + totalFailQty;
    overallQuality = totalProcessedAll > 0 ? qualitySum / totalProcessedAll : 0;
    overallPerformance = unitsWithSummary > 0 ? performanceSum / unitsWithSummary : 0;
    
    // Check if values have changed and update
    const oldTotalSuccess = totalSuccess.textContent;
    const newTotalSuccess = totalSuccessQty.toLocaleString();
    if (oldTotalSuccess !== newTotalSuccess) {
        totalSuccess.textContent = newTotalSuccess;
        elementsToFlashOnUpdate.push(totalSuccess);
    }
    
    const oldTotalFail = totalFail.textContent;
    const newTotalFail = totalFailQty.toLocaleString();
    if (oldTotalFail !== newTotalFail) {
        totalFail.textContent = newTotalFail;
        elementsToFlashOnUpdate.push(totalFail);
    }
    
    const oldTotalQuality = totalQuality.textContent;
    const newTotalQuality = (overallQuality * 100).toFixed(0);
    if (oldTotalQuality !== newTotalQuality) {
        totalQuality.textContent = newTotalQuality;
        elementsToFlashOnUpdate.push(totalQuality);
    }
    
    const oldTotalPerformance = totalPerformance.textContent;
    const newTotalPerformance = (overallPerformance * 100).toFixed(0);
    if (oldTotalPerformance !== newTotalPerformance) {
        totalPerformance.textContent = newTotalPerformance;
        elementsToFlashOnUpdate.push(totalPerformance);
    }
}

// Update the last update time display
function updateLastUpdateTime() {
    const now = new Date();
    lastUpdateTime = now;
    
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    // LIVE data view - always show live update time
    lastUpdateTimeElement.textContent = `Son güncelleme: ${hours}:${minutes}:${seconds}`;
    
    // Hide updating indicator
    updateIndicator.classList.add('hidden');
    
    // Apply flash effect to elements that changed
    const elementsToFlash = [...elementsToFlashOnUpdate]; // Create a copy
    elementsToFlashOnUpdate = []; // Clear the array for next update
    
    // Flash elements that need to show update
    elementsToFlash.forEach(element => {
        if (element && element.classList) {
            // Add flash effect
            element.classList.add('animate-flash');
            // Remove flash effect after animation completes
            setTimeout(() => {
                element.classList.remove('animate-flash');
            }, 1000);
        }
    });
    
    // Flash the real-time indicator to show successful update
    const realTimeIndicator = document.getElementById('real-time-indicator');
    if (realTimeIndicator) {
        realTimeIndicator.classList.add('bg-green-200');
        setTimeout(() => {
            realTimeIndicator.classList.remove('bg-green-200');
            realTimeIndicator.classList.add('bg-green-100');
        }, 1000);
    }
}

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
            
            // Update the time display to reflect the new end time
            updateTimeDisplay();
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
            updateTimeDisplay();
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
            
            // LIVE data view - always refresh
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
            console.log(`[VISIBILITY] Skipping ${unitName} - socket not ready (state: ${socket ? socket.readyState : 'null'})`);
        }
    }
}

// Optimized interval management for background tabs
function startOptimizedIntervals() {
    // Clear any existing intervals
    stopOptimizedIntervals();
    
    // Shift change check (10 seconds normally, but more aggressive when visible)
    const shiftCheckFrequency = isTabVisible ? 10000 : 30000; // 10s when visible, 30s when hidden
    shiftCheckInterval = setInterval(() => {
        if (checkForNewTimePeriod()) {
            console.log('Standard view: Shift change detected, updating time period...');
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
    if (shiftCheckInterval) {
        clearInterval(shiftCheckInterval);
        shiftCheckInterval = null;
    }
    if (visibilityCheckInterval) {
        clearInterval(visibilityCheckInterval);
        visibilityCheckInterval = null;
    }
}

// Debug function to show current time status (live data view)
window.debugTimeStatus = function() {
    const now = new Date();
    
    console.log('=== DEBUG LIVE DATA STATUS ===');
    console.log('Current time:', now.toISOString());
    console.log('EndTime:', endTime.toISOString());
    console.log('Live data view - always current');
    console.log('========================');
    
    return {
        currentTime: now,
        endTime: endTime,
        isLive: true
    };
};

// Debug function to refresh data (call from browser console)
window.refreshLiveData = function() {
    console.log('[DEBUG] Refreshing live data...');
    const now = new Date();
    endTime = now;
    
    updateTimeDisplay();
    updateLastUpdateTime();
    forceDataRefreshAllUnits();
    
    console.log('[DEBUG] Live data refreshed');
    return debugTimeStatus();
}; 