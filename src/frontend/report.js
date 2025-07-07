// Global variables
let selectedUnits = [];
let startTime = null;
let endTime = null;
let timePresetValue = '';
let workingModeValue = 'mode1';

// Chart instances
let totalSuccessChart = null;
let totalFailChart = null;
let qualityChart = null;
let performanceChart = null;
let oeeChart = null;

// Unit data storage
let unitData = {};
let unitSockets = {};

// Track elements that need flash animation on update
let elementsToFlashOnUpdate = [];

// Current sort metric and order
let currentSortMetric = 'totalSuccess'; // default sort by total success
let currentSortOrder = 'desc'; // desc or asc

// Background tab handling variables
let isTabVisible = true;
let lastVisibilityChange = Date.now();
let visibilityCheckInterval = null;
let clockUpdateInterval = null; // Add clock update interval for live time display

// Quality chart drill-down state
let qualityChartDrilldownState = {
    isInDrilldown: false,
    selectedUnit: null,
    originalData: null
};

// Fail chart drill-down state
let failChartDrilldownState = {
    isInDrilldown: false,
    selectedUnit: null,
    originalData: null
};

// Production chart drill-down state
let productionChartDrilldownState = {
    isInDrilldown: false,
    selectedUnit: null,
    originalData: null
};

// Performance chart drill-down state
let performanceChartDrilldownState = {
    isInDrilldown: false,
    selectedUnit: null,
    originalData: null
};

// UI elements
let loadingIndicator;
let chartsContainer;
let selectedUnitsDisplay;
let timeRangeDisplay;
let lastUpdateTimeElement;
let updateIndicator;
let summaryContainer;

// Working mode configurations (same as other views)
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
    // Initialize DOM elements
    loadingIndicator = document.getElementById('loading-indicator');
    chartsContainer = document.getElementById('charts-container');
    selectedUnitsDisplay = document.getElementById('selected-units-display');
    timeRangeDisplay = document.getElementById('time-range-display');
    lastUpdateTimeElement = document.getElementById('last-update-time');
    updateIndicator = document.getElementById('update-indicator');
    summaryContainer = document.getElementById('summary-container');

    // Set up background tab optimization
    isTabVisible = !document.hidden;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    startVisibilityCheck();
    
    // Start clock updates for live data
    startTimeUpdates();

    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);
    
    selectedUnits = params.getAll('units');
    timePresetValue = params.get('preset') || '';
    workingModeValue = params.get('workingMode') || 'mode1';
    
    const startParam = params.get('start');
    const endParam = params.get('end');
    
    if (startParam) startTime = new Date(startParam);
    if (endParam) endTime = new Date(endParam);
    
    // Validate parameters
    if (selectedUnits.length === 0 || !startTime || !endTime) {
        alert('Eksik parametreler var. Ana sayfaya yönlendiriyoruz.');
        window.location.href = '/';
        return;
    }
    
    // Update UI with parameters
    updateSelectedUnitsDisplay();
    updateTimeDisplay();
    updateLastUpdateTime();
    
    // Setup sort functionality for summary cards
    setupSortingEventListeners();
    
    // Load data and create charts
    loadData();
    
    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        stopVisibilityCheck();
        stopTimeUpdates();
        for (const unitName in unitSockets) {
            if (unitSockets[unitName]) {
                unitSockets[unitName].close();
            }
        }
    });
});

// Setup sorting event listeners for summary cards
function setupSortingEventListeners() {
    // Get all summary cards (using more specific selectors to avoid conflicts)
    const summaryCards = [
        { element: document.querySelector('.bg-yellow-100'), metric: 'totalSuccess', name: 'Toplam Üretim' },
        { element: document.querySelector('.bg-red-100'), metric: 'totalFail', name: 'Toplam Tamir' },
        { element: document.querySelector('#summary-container .bg-green-100'), metric: 'quality', name: 'Kalite' },
        { element: document.querySelector('#summary-container .bg-blue-100'), metric: 'performance', name: 'Performance' }
    ];
    
    summaryCards.forEach(card => {
        if (card.element) {
            // Add cursor pointer style
            card.element.style.cursor = 'pointer';
            card.element.style.transition = 'transform 0.2s, box-shadow 0.2s';
            
            // Add hover effects
            card.element.addEventListener('mouseenter', () => {
                card.element.style.transform = 'scale(1.02)';
                card.element.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
            });
            
            card.element.addEventListener('mouseleave', () => {
                card.element.style.transform = 'scale(1)';
                card.element.style.boxShadow = 'none';
            });
            
            // Add click event listener
            card.element.addEventListener('click', () => {
                // Toggle sort order if clicking the same metric, otherwise set to desc
                if (currentSortMetric === card.metric) {
                    currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
                } else {
                    currentSortMetric = card.metric;
                    currentSortOrder = 'desc';
                }
                
                // Update visual indicators
                updateSortIndicators();
                
                // Re-sort and update charts
                updateCharts();
                
                console.log(`Sorting by ${card.name} (${card.metric}) in ${currentSortOrder} order`);
            });
        }
    });
    
    // Set initial sort indicator
    updateSortIndicators();
}

// Update visual indicators for current sort
function updateSortIndicators() {
    // Remove all existing sort indicators
    document.querySelectorAll('.sort-indicator').forEach(el => el.remove());
    
    // Find the current metric's card and add indicator
    const metricToSelector = {
        'totalSuccess': '.bg-yellow-100',
        'totalFail': '.bg-red-100',
        'quality': '#summary-container .bg-green-100',
        'performance': '#summary-container .bg-blue-100'
    };
    
    const currentCard = document.querySelector(metricToSelector[currentSortMetric]);
    if (currentCard) {
        // Add sort indicator
        const indicator = document.createElement('div');
        indicator.className = 'sort-indicator absolute top-2 right-2 text-xs font-bold';
        indicator.innerHTML = currentSortOrder === 'desc' ? '↓' : '↑';
        indicator.style.position = 'absolute';
        indicator.style.top = '8px';
        indicator.style.right = '8px';
        indicator.style.fontSize = '16px';
        indicator.style.fontWeight = 'bold';
        
        // Make the card relative positioned if it isn't already
        if (getComputedStyle(currentCard).position === 'static') {
            currentCard.style.position = 'relative';
        }
        
        currentCard.appendChild(indicator);
        
        // Add a subtle border to indicate it's the active sort
        currentCard.style.border = '2px solid rgba(59, 130, 246, 0.5)';
    }
    
    // Remove border from other cards
    const allCards = ['.bg-yellow-100', '.bg-red-100', '#summary-container .bg-green-100', '#summary-container .bg-blue-100'];
    allCards.forEach(selector => {
        const card = document.querySelector(selector);
        if (card && selector !== metricToSelector[currentSortMetric]) {
            card.style.border = 'none';
        }
    });
}

// Get sorted unit data based on current sort settings
function getSortedUnitData() {
    // Calculate metrics for all units
    const unitMetricsWithNames = selectedUnits.map(unit => ({
        name: unit,
        metrics: calculateUnitMetrics(unit)
    }));
    
    // Sort based on current metric and order
    unitMetricsWithNames.sort((a, b) => {
        const aValue = a.metrics[currentSortMetric];
        const bValue = b.metrics[currentSortMetric];
        
        if (currentSortOrder === 'desc') {
            return bValue - aValue;
        } else {
            return aValue - bValue;
        }
    });
    
    return {
        unitNames: unitMetricsWithNames.map(item => item.name),
        unitMetrics: unitMetricsWithNames.map(item => item.metrics)
    };
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

// Update time range display for live data
function updateTimeDisplay() {
    // For live data, use current time as the end time to show accurate live range
    const now = new Date();
    const currentTimeDifference = now.getTime() - endTime.getTime();
    const fiveMinutesInMs = 5 * 60 * 1000;
    
    // Determine if this is live data (end time within 5 minutes of current time or is shift-based)
    const isShiftBasedView = timePresetValue && (timePresetValue.startsWith('shift'));
    const isLiveData = currentTimeDifference <= fiveMinutesInMs || isShiftBasedView;
    
    // Use current time for live data, original endTime for historical data
    const displayEndTime = isLiveData ? now : endTime;
    
    let timeRangeText = `${formatDateForDisplay(startTime)} - ${formatDateForDisplay(displayEndTime)}`;
    
    if (timePresetValue && workingModeValue) {
        const shifts = workingModes[workingModeValue].shifts;
        const shiftConfig = shifts.find(s => s.id === timePresetValue);
        
        if (shiftConfig) {
            const workingModeName = workingModes[workingModeValue].name;
            const presetName = `${workingModeName} - Vardiya: ${shiftConfig.name}`;
            timeRangeText = `${presetName} | ${timeRangeText}`;
        }
    }
    
    // Add live data indicator for live data, or historical indicator for historical data
    if (isLiveData) {
    timeRangeText = `🟢 Canlı Veri: ${timeRangeText}`;
    } else {
        timeRangeText = `📊 Geçmiş Veri: ${timeRangeText}`;
    }
    
    if (timeRangeDisplay) {
        timeRangeDisplay.textContent = timeRangeText;
        timeRangeDisplay.style.color = '#1F2937'; // Normal dark color
        timeRangeDisplay.style.fontStyle = 'normal';
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

// Update last update time for live data
function updateLastUpdateTime() {
    if (lastUpdateTimeElement) {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    lastUpdateTimeElement.textContent = `Son güncelleme: ${hours}:${minutes}:${seconds}`;
    }
    
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
}

// Background tab optimization functions
function handleVisibilityChange() {
    const wasVisible = isTabVisible;
    isTabVisible = !document.hidden;
    lastVisibilityChange = Date.now();

    console.log(`[REPORT VISIBILITY] Tab visibility changed: ${wasVisible ? 'visible' : 'hidden'} → ${isTabVisible ? 'visible' : 'hidden'}`);

    if (!wasVisible && isTabVisible) {
        // Tab became visible - force immediate refresh for real-time data
        console.log('[REPORT VISIBILITY] Tab became visible - forcing immediate data refresh');

        // For live data views, update endTime to current time to maintain live status
        const now = new Date();
        const originalTimeDifference = now.getTime() - endTime.getTime();
        const fiveMinutesInMs = 5 * 60 * 1000;
        const wasOriginallyLive = originalTimeDifference <= fiveMinutesInMs;

        // Check if this is a shift-based live data view
        const isShiftBasedView = timePresetValue && (timePresetValue.startsWith('shift'));
        const shouldUpdateEndTime = wasOriginallyLive || isShiftBasedView;

        console.log(`[REPORT VISIBILITY] Was originally live: ${wasOriginallyLive}, Is shift-based: ${isShiftBasedView}`);

        if (shouldUpdateEndTime) {
            // This was originally a live data view, so update endTime to maintain live status
            console.log('[REPORT VISIBILITY] Updating endTime to maintain live data status');
            const oldEndTime = endTime.toISOString();
            endTime = now;
            console.log(`[REPORT VISIBILITY] EndTime updated: ${oldEndTime} → ${endTime.toISOString()}`);

            // Update the time display to reflect the new end time
            updateTimeDisplay();
            updateLastUpdateTime();
        }

        // Force data refresh for all active WebSocket connections
        forceDataRefreshAllUnits();

        // Defer UI update to next frame to avoid blocking
        requestAnimationFrame(() => {
            updateTimeDisplay();
            updateLastUpdateTime();
            console.log('[REPORT VISIBILITY] Forced UI update after data refresh');
        });
    }
}

function startVisibilityCheck() {
    // Stop any existing check
    stopVisibilityCheck();
    
    // OPTIMIZED: Reduce monitoring frequency to reduce CPU overhead
    // Most visibility changes are detected by the built-in event listener
    // This is just a backup check for edge cases
    visibilityCheckInterval = setInterval(() => {
        const currentVisible = !document.hidden;
        if (currentVisible !== isTabVisible) {
            // Visibility state changed, handle it
            console.log('[REPORT VISIBILITY] Detected visibility change via monitoring');
            handleVisibilityChange();
        }
    }, 10000); // Reduced to every 10 seconds for lower overhead

    console.log('[REPORT VISIBILITY] Started optimized background tab monitoring');
}

function stopVisibilityCheck() {
    if (visibilityCheckInterval) {
        clearInterval(visibilityCheckInterval);
        visibilityCheckInterval = null;
    }
}

// Start time updates for live data
function startTimeUpdates() {
    // Stop any existing timer
    stopTimeUpdates();
    
    // OPTIMIZED: Update time display every 5 seconds instead of every second
    // This reduces CPU overhead while still keeping the display reasonably current
    clockUpdateInterval = setInterval(() => {
        updateTimeDisplay();
    }, 5000);
    
    console.log('[REPORT TIME] Started optimized time updates (5s interval)');
}

function stopTimeUpdates() {
    if (clockUpdateInterval) {
        clearInterval(clockUpdateInterval);
        clockUpdateInterval = null;
    }
}

function forceDataRefreshAllUnits() {
    console.log('[REPORT VISIBILITY] forceDataRefreshAllUnits called');
    console.log('[REPORT VISIBILITY] Current endTime:', endTime.toISOString());
    console.log('[REPORT VISIBILITY] Current time:', new Date().toISOString());

    let refreshCount = 0;
    for (const unitName in unitSockets) {
        const socket = unitSockets[unitName];
        if (socket && socket.readyState === WebSocket.OPEN) {
            console.log(`[REPORT VISIBILITY] Forcing data refresh for unit: ${unitName}`);

            // For live data, always use current time as end time
            const requestEndTime = new Date();
            const params = {
                start_time: startTime.toISOString(),
                end_time: requestEndTime.toISOString(),
                working_mode: workingModeValue || 'mode1'
            };

            console.log(`[REPORT VISIBILITY] Sending refresh request for ${unitName}:`, {
                start: params.start_time,
                end: params.end_time,
                working_mode: params.working_mode
            });

            socket.send(JSON.stringify(params));
            refreshCount++;
        } else {
            console.log(`[REPORT VISIBILITY] Skipping ${unitName} - socket not ready (state: ${socket ? socket.readyState : 'null'})`);
        }
    }
    
    // Show update indicator only if we actually sent refresh requests
    if (refreshCount > 0 && updateIndicator) {
        updateIndicator.classList.remove('hidden');
        // Auto-hide after longer delay for batch operations
        setTimeout(() => {
            updateIndicator.classList.add('hidden');
        }, 1500);
    }
}

// Load data for all units
function loadData() {
    // Show loading, hide charts
    loadingIndicator.classList.remove('hidden');
    chartsContainer.classList.add('hidden');
    
    // Initialize unit data
    selectedUnits.forEach(unit => {
        unitData[unit] = { models: [], summary: null };
    });
    
    let completedRequests = 0;
    
    function checkAllRequestsCompleted() {
        completedRequests++;
        if (completedRequests === selectedUnits.length) {
            createCharts();
            loadingIndicator.classList.add('hidden');
            chartsContainer.classList.remove('hidden');
            summaryContainer.classList.remove('hidden');
            updateLastUpdateTime();
        }
    }
    
    // Connect to WebSocket for each unit
    selectedUnits.forEach(unit => {
        connectWebSocket(unit, startTime, endTime, () => {
            checkAllRequestsCompleted();
        });
    });
}

// Connect to WebSocket and handle data
function connectWebSocket(unitName, startTime, endTime, callback) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/${unitName}`;
    
    const unitSocket = new WebSocket(wsUrl);
    unitSockets[unitName] = unitSocket;
    
    let hasReceivedInitialData = false;
    let updateInterval = null;
    let reconnectAttempts = 0;
    let lastRequestTime = 0;
    
    // Pre-calculate reusable values to reduce overhead
    const workingMode = workingModeValue || 'mode1';
    const startTimeISO = startTime.toISOString();
    
    function sendDataRequest() {
        if (unitSocket.readyState === WebSocket.OPEN) {
            const now = Date.now();
            
            // Throttle requests to prevent excessive calls (minimum 10 seconds between requests)
            if (now - lastRequestTime < 10000) {
                console.log(`[REPORT THROTTLE] Skipping request for ${unitName} - too soon (${now - lastRequestTime}ms ago)`);
                return;
            }
            
            lastRequestTime = now;
            
            // For live data, use current time as end time (optimized)
            const currentEndTime = new Date(now);
            const params = {
                start_time: startTimeISO, // Reuse pre-calculated value
                end_time: currentEndTime.toISOString(),
                working_mode: workingMode // Reuse pre-calculated value
            };
            
            console.log(`[REPORT REQUEST] Sending data request for ${unitName}`);
            unitSocket.send(JSON.stringify(params));
        }
    }
    
    // Connection timeout
    const connectionTimeout = setTimeout(() => {
        if (!hasReceivedInitialData) {
            hasReceivedInitialData = true;
            unitData[unitName] = { models: [], summary: null };
            callback([]);
        }
    }, 10000);
    
    unitSocket.onopen = () => {
        reconnectAttempts = 0;
        sendDataRequest();
        
        // OPTIMIZED INTERVAL SYSTEM
        const UPDATE_INTERVAL = 20000; // 20 seconds - balanced approach
        
        updateInterval = setInterval(() => {
            // Only send request if connection is still open and tab is active
            if (unitSocket.readyState === WebSocket.OPEN) {
                // For background tabs, skip some requests to reduce server load
                // but still maintain reasonable update frequency
                const shouldSkipRequest = !isTabVisible && Math.random() < 0.3; // Skip 30% of requests when hidden
                
                if (!shouldSkipRequest) {
                    sendDataRequest();
                } else {
                    console.log(`[REPORT OPTIMIZATION] Skipping background request for ${unitName}`);
                }
            } else {
                console.log(`[REPORT ERROR] Connection lost for ${unitName}, clearing interval`);
                clearInterval(updateInterval);
                updateInterval = null;
            }
        }, UPDATE_INTERVAL);
        
        console.log(`[REPORT WEBSOCKET] Connected to ${unitName} with optimized ${UPDATE_INTERVAL}ms interval`);
    };
    
    unitSocket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.error) {
                console.error(`Error for "${unitName}":`, data.error);
                if (!hasReceivedInitialData) {
                    hasReceivedInitialData = true;
                    clearTimeout(connectionTimeout);
                    unitData[unitName] = { models: [], summary: null };
                    callback([]);
                }
            } else {
                // Check if data has the new structure with models and summary
                if (data.models && data.summary) {
                    // New structure: store both models and summary
                    unitData[unitName] = {
                        models: data.models.map(item => ({
                            ...item,
                            unit: unitName
                        })),
                        summary: data.summary
                    };
                } else {
                    // Old structure: assume data is array of models (fallback)
                    unitData[unitName] = {
                        models: data.map(item => ({
                            ...item,
                            unit: unitName
                        })),
                        summary: null
                    };
                }
                
                if (!hasReceivedInitialData) {
                    hasReceivedInitialData = true;
                    clearTimeout(connectionTimeout);
                    callback(data.models || data);
                } else {
                    // Batch UI updates to prevent excessive redraws
                    requestAnimationFrame(() => {
                    // Show update indicator
                    updateIndicator.classList.remove('hidden');
                    
                    // Update charts with new data
                    updateCharts();
                    updateLastUpdateTime();
                    
                    // Hide update indicator after a brief moment
                    setTimeout(() => {
                        updateIndicator.classList.add('hidden');
                        }, 800);
                    });
                }
            }
        } catch (error) {
            console.error(`Error parsing data for "${unitName}":`, error);
            if (!hasReceivedInitialData) {
                hasReceivedInitialData = true;
                clearTimeout(connectionTimeout);
                unitData[unitName] = { models: [], summary: null };
                callback([]);
            }
        }
    };
    
    unitSocket.onerror = (error) => {
        console.error(`WebSocket error for "${unitName}":`, error);
        reconnectAttempts++;
        
        // Clean up intervals
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        
        if (!hasReceivedInitialData) {
            hasReceivedInitialData = true;
            clearTimeout(connectionTimeout);
            unitData[unitName] = { models: [], summary: null };
            callback([]);
        }
    };
    
    unitSocket.onclose = (event) => {
        // Clean up intervals
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        
        console.log(`[REPORT WEBSOCKET] Connection closed for "${unitName}" (code: ${event.code})`);
        
        if (!hasReceivedInitialData) {
            hasReceivedInitialData = true;
            clearTimeout(connectionTimeout);
            unitData[unitName] = { models: [], summary: null };
            callback([]);
        }
        
        // Auto-reconnect for unexpected closures
        if (event.code !== 1000 && reconnectAttempts < 5) { // 1000 = normal closure
            const reconnectDelay = Math.min(5000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff, max 30s
            console.log(`[REPORT RECONNECT] Will attempt to reconnect ${unitName} in ${reconnectDelay}ms (attempt ${reconnectAttempts + 1}/5)`);
            
            setTimeout(() => {
                if (!unitSockets[unitName] || unitSockets[unitName].readyState === WebSocket.CLOSED) {
                    console.log(`[REPORT RECONNECT] Attempting to reconnect ${unitName}`);
                    connectWebSocket(unitName, startTime, endTime, () => {
                        // Force immediate chart update after reconnection
                        updateCharts();
                        updateLastUpdateTime();
                    });
                }
            }, reconnectDelay);
        }
    };
}

// Calculate unit metrics
function calculateUnitMetrics(unitName) {
    const unitDataObj = unitData[unitName];
    
    if (!unitDataObj) {
        return {
            totalSuccess: 0,
            totalFail: 0,
            quality: 0,
            performance: 0
        };
    }
    
    // Check if we have backend-calculated summary (preferred)
    if (unitDataObj.summary) {
        // Use backend summary values - check for new unit_performance_sum field
        const performance = unitDataObj.summary.unit_performance_sum !== undefined ? 
            unitDataObj.summary.unit_performance_sum : 
            unitDataObj.summary.total_performance;
            
        return {
            totalSuccess: unitDataObj.summary.total_success || 0,
            totalFail: unitDataObj.summary.total_fail || 0,
            quality: (unitDataObj.summary.total_quality || 0) * 100,
            performance: (performance || 0) * 100
        };
    }
    
    // Fallback: calculate from model data if no summary (shouldn't happen with new backend)
    const data = unitDataObj.models || unitDataObj || [];
    
    if (data.length === 0) {
        return {
            totalSuccess: 0,
            totalFail: 0,
            quality: 0,
            performance: 0
        };
    }
    
    // Calculate totals for this unit
    let totalSuccess = 0;
    let totalFail = 0;
    let totalQty = 0;
    let weightedQualitySum = 0;
    
    data.forEach(model => {
        totalSuccess += model.success_qty;
        totalFail += model.fail_qty;
        totalQty += model.total_qty;
        
        const modelQuality = (model.success_qty + model.fail_qty) > 0 ? model.success_qty / (model.success_qty + model.fail_qty) : 0;
        weightedQualitySum += modelQuality * (model.success_qty + model.fail_qty);
    });
    
    const quality = (totalSuccess + totalFail) > 0 ? weightedQualitySum / (totalSuccess + totalFail) : 0;
    
    // Fallback: Calculate sum of all model performances for this unit
    let totalPerformance = 0;
    
    data.forEach(model => {
        if (model.performance !== null && model.performance !== undefined) {
            totalPerformance += model.performance;
        }
    });
    
    const performance = totalPerformance;
    
    return {
        totalSuccess: totalSuccess,
        totalFail: totalFail,
        quality: quality * 100,
        performance: performance * 100
    };
}

// Create charts
function createCharts() {
    // Get sorted unit data based on current sort settings
    const sortedData = getSortedUnitData();
    const unitNames = sortedData.unitNames;
    const unitMetrics = sortedData.unitMetrics;
    
    // Colors for different units
    const colors = [
        '#3B82F6', '#EF4444', '#10B981', '#F59E0B', 
        '#8B5CF6', '#06B6D4', '#F97316', '#84CC16'
    ];
    
    // Total Success Chart
    const totalSuccessCtx = document.getElementById('totalSuccessChart').getContext('2d');
    totalSuccessChart = new Chart(totalSuccessCtx, {
        type: 'bar',
        data: {
            labels: unitNames,
            datasets: [{
                label: 'Toplam Üretim',
                data: unitMetrics.map(m => m.totalSuccess),
                backgroundColor: colors.slice(0, unitNames.length),
                borderColor: colors.slice(0, unitNames.length),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const elementIndex = elements[0].index;
                    if (!productionChartDrilldownState.isInDrilldown) {
                        // Drill down to unit models - get current unit name from chart labels
                        const unitName = totalSuccessChart.data.labels[elementIndex];
                        drillDownToUnitModelsProduction(unitName);
                    }
                }
            }
        }
    });
    
    // Total Fail Chart
    const totalFailCtx = document.getElementById('totalFailChart').getContext('2d');
    totalFailChart = new Chart(totalFailCtx, {
        type: 'bar',
        data: {
            labels: unitNames,
            datasets: [{
                label: 'Toplam Tamir',
                data: unitMetrics.map(m => m.totalFail),
                backgroundColor: colors.slice(0, unitNames.length),
                borderColor: colors.slice(0, unitNames.length),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const elementIndex = elements[0].index;
                    if (!failChartDrilldownState.isInDrilldown) {
                        // Drill down to unit models - get current unit name from chart labels
                        const unitName = totalFailChart.data.labels[elementIndex];
                        drillDownToUnitModelsFail(unitName);
                    }
                }
            }
        }
    });
    
    // Quality Chart
    const qualityCtx = document.getElementById('qualityChart').getContext('2d');
    qualityChart = new Chart(qualityCtx, {
        type: 'bar',
        data: {
            labels: unitNames,
            datasets: [{
                label: 'Kalite (%)',
                data: unitMetrics.map(m => m.quality),
                backgroundColor: colors.slice(0, unitNames.length),
                borderColor: colors.slice(0, unitNames.length),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const elementIndex = elements[0].index;
                    if (!qualityChartDrilldownState.isInDrilldown) {
                        // Drill down to unit models - get current unit name from chart labels
                        const unitName = qualityChart.data.labels[elementIndex];
                        drillDownToUnitModels(unitName);
                    }
                }
            }
        }
    });
    
    // Performance Chart
    const performanceCtx = document.getElementById('performanceChart').getContext('2d');
    performanceChart = new Chart(performanceCtx, {
        type: 'bar',
        data: {
            labels: unitNames,
            datasets: [{
                label: 'OEE (%)',
                data: unitMetrics.map(m => m.performance),
                backgroundColor: colors.slice(0, unitNames.length),
                borderColor: colors.slice(0, unitNames.length),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const elementIndex = elements[0].index;
                    if (!performanceChartDrilldownState.isInDrilldown) {
                        // Drill down to unit models - get current unit name from chart labels
                        const unitName = performanceChart.data.labels[elementIndex];
                        drillDownToUnitModelsPerformance(unitName);
                    }
                }
            }
        }
    });
    
    // Update summary statistics
    updateSummaryStatistics(unitMetrics);
    
    // Update sort indicators after charts are created
    updateSortIndicators();
}

// Update charts with new data
function updateCharts() {
    if (!totalSuccessChart) return;
    
    // Get sorted unit data based on current sort settings
    const sortedData = getSortedUnitData();
    const unitNames = sortedData.unitNames;
    const unitMetrics = sortedData.unitMetrics;
    
    // Only update production chart if not in drill-down mode
    if (!productionChartDrilldownState.isInDrilldown) {
    totalSuccessChart.data.labels = unitNames;
        totalSuccessChart.data.datasets[0].data = unitMetrics.map(m => m.totalSuccess);
    }
    
    // Only update fail chart if not in drill-down mode
    if (!failChartDrilldownState.isInDrilldown) {
        totalFailChart.data.labels = unitNames;
        totalFailChart.data.datasets[0].data = unitMetrics.map(m => m.totalFail);
    }
    
    // Only update quality chart if not in drill-down mode
    if (!qualityChartDrilldownState.isInDrilldown) {
        qualityChart.data.labels = unitNames;
        qualityChart.data.datasets[0].data = unitMetrics.map(m => m.quality);
    }
    
    // Only update performance chart if not in drill-down mode
    if (!performanceChartDrilldownState.isInDrilldown) {
    performanceChart.data.labels = unitNames;
        performanceChart.data.datasets[0].data = unitMetrics.map(m => m.performance);
    }
    
    // Update charts
    totalSuccessChart.update('none');
    
    // Only update fail chart if not in drill-down mode
    if (!failChartDrilldownState.isInDrilldown) {
        totalFailChart.update('none');
    }
    
    // Only update quality chart if not in drill-down mode
    if (!qualityChartDrilldownState.isInDrilldown) {
        qualityChart.update('none');
    }
    
    performanceChart.update('none');
    
    // Update summary statistics
    updateSummaryStatistics(unitMetrics);
}

// Update summary statistics
function updateSummaryStatistics(unitMetrics) {
    const totalSuccess = unitMetrics.reduce((sum, m) => sum + m.totalSuccess, 0);
    const totalFail = unitMetrics.reduce((sum, m) => sum + m.totalFail, 0);
    
    // Calculate weighted average quality (already weighted by production in individual unit calculations)
    let weightedQualitySum = 0;
    let totalProduction = 0;
    
    unitMetrics.forEach(m => {
        const unitProduction = m.totalSuccess + m.totalFail;
        if (unitProduction > 0) {
            weightedQualitySum += (m.quality / 100) * unitProduction;
            totalProduction += unitProduction;
        }
    });
    
    const avgQuality = totalProduction > 0 ? (weightedQualitySum / totalProduction) * 100 : 0;
    
    // Calculate weighted average performance based on unit success values
    let weightedPerformanceSum = 0;
    let totalSuccessWeight = 0;
    
    unitMetrics.forEach(m => {
        if (m.totalSuccess > 0) {
            weightedPerformanceSum += (m.performance / 100) * m.totalSuccess;
            totalSuccessWeight += m.totalSuccess;
        }
    });
    
    const avgPerformance = totalSuccessWeight > 0 ? (weightedPerformanceSum / totalSuccessWeight) * 100 : 0;
    
    // Check if values have changed and update individual elements
    const totalSuccessElement = document.getElementById('total-success');
    const oldTotalSuccess = totalSuccessElement.textContent;
    const newTotalSuccess = totalSuccess.toLocaleString();
    if (oldTotalSuccess !== newTotalSuccess) {
        totalSuccessElement.textContent = newTotalSuccess;
        elementsToFlashOnUpdate.push(totalSuccessElement);
    }
    
    const totalFailElement = document.getElementById('total-fail');
    const oldTotalFail = totalFailElement.textContent;
    const newTotalFail = totalFail.toLocaleString();
    if (oldTotalFail !== newTotalFail) {
        totalFailElement.textContent = newTotalFail;
        elementsToFlashOnUpdate.push(totalFailElement);
    }
    
    const avgQualityElement = document.getElementById('avg-quality');
    const oldAvgQuality = avgQualityElement.textContent;
    const newAvgQuality = avgQuality.toFixed(0);
    if (oldAvgQuality !== newAvgQuality) {
        avgQualityElement.textContent = newAvgQuality;
        elementsToFlashOnUpdate.push(avgQualityElement);
    }
    
    const avgPerformanceElement = document.getElementById('avg-performance');
    const oldAvgPerformance = avgPerformanceElement.textContent;
    const newAvgPerformance = avgPerformance.toFixed(0);
    if (oldAvgPerformance !== newAvgPerformance) {
        avgPerformanceElement.textContent = newAvgPerformance;
        elementsToFlashOnUpdate.push(avgPerformanceElement);
    }
}

// Drill down to show model-level quality data for a specific unit
function drillDownToUnitModels(unitName) {
    const unitDataObj = unitData[unitName];
    if (!unitDataObj) return;

    // Store original data for returning back
    qualityChartDrilldownState.originalData = {
        labels: qualityChart.data.labels.slice(),
        data: qualityChart.data.datasets[0].data.slice(),
        backgroundColor: qualityChart.data.datasets[0].backgroundColor.slice(),
        borderColor: qualityChart.data.datasets[0].borderColor.slice(),
        title: 'Kalite (%)'
    };
    
    qualityChartDrilldownState.isInDrilldown = true;
    qualityChartDrilldownState.selectedUnit = unitName;

    // Get model data
    const models = unitDataObj.models || [];
    
    if (models.length === 0) {
        console.log('No model data available for unit:', unitName);
        return;
    }

    // Calculate quality for each model
    const modelData = models.map(model => {
        const totalProduced = (model.success_qty || 0) + (model.fail_qty || 0);
        const quality = totalProduced > 0 ? ((model.success_qty || 0) / totalProduced) * 100 : 0;
        return {
            name: model.model || 'Unknown Model',
            quality: quality
        };
    });

    // Sort models by quality descending
    modelData.sort((a, b) => b.quality - a.quality);

    // Colors for models
    const modelColors = [
        '#3B82F6', '#EF4444', '#10B981', '#F59E0B', 
        '#8B5CF6', '#06B6D4', '#F97316', '#84CC16',
        '#6366F1', '#EC4899', '#14B8A6', '#F59E0B'
    ];

    // Update quality chart with model data
    qualityChart.data.labels = modelData.map(m => m.name);
    qualityChart.data.datasets[0].data = modelData.map(m => m.quality);
    qualityChart.data.datasets[0].backgroundColor = modelColors.slice(0, modelData.length);
    qualityChart.data.datasets[0].borderColor = modelColors.slice(0, modelData.length);
    qualityChart.data.datasets[0].label = `${unitName} - Model Kalite (%)`;
    
    qualityChart.update('active');

    // Update chart title and add back button
    updateQualityChartTitle(`${unitName} - Model Kalite Detayı`, true);
}

// Return to unit-level view
function returnToUnitView() {
    if (!qualityChartDrilldownState.isInDrilldown || !qualityChartDrilldownState.originalData) return;

    // Restore original data
    const originalData = qualityChartDrilldownState.originalData;
    qualityChart.data.labels = originalData.labels;
    qualityChart.data.datasets[0].data = originalData.data;
    qualityChart.data.datasets[0].backgroundColor = originalData.backgroundColor;
    qualityChart.data.datasets[0].borderColor = originalData.borderColor;
    qualityChart.data.datasets[0].label = 'Kalite (%)';
    
    qualityChart.update('active');

    // Reset drill-down state
    qualityChartDrilldownState.isInDrilldown = false;
    qualityChartDrilldownState.selectedUnit = null;
    qualityChartDrilldownState.originalData = null;

    // Update chart title and remove back button
    updateQualityChartTitle('Kalite (%)', false);
}

// Update quality chart title and back button
function updateQualityChartTitle(title, showBackButton) {
    const qualityChartContainer = document.querySelector('#qualityChart').closest('.bg-white');
    if (!qualityChartContainer) return;

    let titleElement = qualityChartContainer.querySelector('h3');
    if (!titleElement) return;

    // Remove existing back button if any
    const existingBackButton = qualityChartContainer.querySelector('.quality-back-button');
    if (existingBackButton) {
        existingBackButton.remove();
    }

    // Update title
    titleElement.textContent = title;

    // Add back button if needed
    if (showBackButton) {
        const backButton = document.createElement('button');
        backButton.className = 'quality-back-button ml-2 px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors';
        backButton.textContent = '← Geri';
        backButton.style.fontSize = '12px';
        backButton.onclick = returnToUnitView;
        
        // Create a flex container for title and button
        const headerContainer = document.createElement('div');
        headerContainer.className = 'flex items-center justify-between mb-4';
        
        const titleContainer = document.createElement('div');
        titleContainer.className = 'flex items-center';
        titleContainer.appendChild(titleElement.cloneNode(true));
        titleContainer.appendChild(backButton);
        
        headerContainer.appendChild(titleContainer);
        
        // Replace the original title
        titleElement.parentNode.replaceChild(headerContainer, titleElement);
    }
}

// Drill down to show model-level fail data for a specific unit
function drillDownToUnitModelsFail(unitName) {
    const unitDataObj = unitData[unitName];
    if (!unitDataObj) return;

    // Store original data for returning back
    failChartDrilldownState.originalData = {
        labels: totalFailChart.data.labels.slice(),
        data: totalFailChart.data.datasets[0].data.slice(),
        backgroundColor: totalFailChart.data.datasets[0].backgroundColor.slice(),
        borderColor: totalFailChart.data.datasets[0].borderColor.slice(),
        title: 'Toplam Tamir'
    };
    
    failChartDrilldownState.isInDrilldown = true;
    failChartDrilldownState.selectedUnit = unitName;

    // Get model data
    const models = unitDataObj.models || [];
    
    if (models.length === 0) {
        console.log('No model data available for unit:', unitName);
        return;
    }

    // Calculate fail quantities for each model
    const modelData = models.map(model => {
        return {
            name: model.model || 'Unknown Model',
            failQty: model.fail_qty || 0
        };
    });

    // Sort models by fail quantity descending
    modelData.sort((a, b) => b.failQty - a.failQty);

    // Colors for models
    const modelColors = [
        '#EF4444', '#DC2626', '#B91C1C', '#991B1B', 
        '#7F1D1D', '#F87171', '#FCA5A5', '#FECACA',
        '#FEE2E2', '#FEF2F2', '#F59E0B', '#F97316'
    ];

    // Update fail chart with model data
    totalFailChart.data.labels = modelData.map(m => m.name);
    totalFailChart.data.datasets[0].data = modelData.map(m => m.failQty);
    totalFailChart.data.datasets[0].backgroundColor = modelColors.slice(0, modelData.length);
    totalFailChart.data.datasets[0].borderColor = modelColors.slice(0, modelData.length);
    totalFailChart.data.datasets[0].label = `${unitName} - Model Tamir`;
    
    totalFailChart.update('active');

    // Update chart title and add back button
    updateFailChartTitle(`${unitName} - Model Tamir Detayı`, true);
}

// Return to unit-level view for fail chart
function returnToUnitViewFail() {
    if (!failChartDrilldownState.isInDrilldown || !failChartDrilldownState.originalData) return;

    // Restore original data
    const originalData = failChartDrilldownState.originalData;
    totalFailChart.data.labels = originalData.labels;
    totalFailChart.data.datasets[0].data = originalData.data;
    totalFailChart.data.datasets[0].backgroundColor = originalData.backgroundColor;
    totalFailChart.data.datasets[0].borderColor = originalData.borderColor;
    totalFailChart.data.datasets[0].label = 'Toplam Tamir';
    
    totalFailChart.update('active');

    // Reset drill-down state
    failChartDrilldownState.isInDrilldown = false;
    failChartDrilldownState.selectedUnit = null;
    failChartDrilldownState.originalData = null;

    // Update chart title and remove back button
    updateFailChartTitle('Toplam Tamir', false);
}

// Update fail chart title and back button
function updateFailChartTitle(title, showBackButton) {
    const failChartContainer = document.querySelector('#totalFailChart').closest('.bg-white');
    if (!failChartContainer) return;

    let titleElement = failChartContainer.querySelector('h3');
    if (!titleElement) return;

    // Remove existing back button if any
    const existingBackButton = failChartContainer.querySelector('.fail-back-button');
    if (existingBackButton) {
        existingBackButton.remove();
    }

    // Update title
    titleElement.textContent = title;

    // Add back button if needed
    if (showBackButton) {
        const backButton = document.createElement('button');
        backButton.className = 'fail-back-button ml-2 px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors';
        backButton.textContent = '← Geri';
        backButton.style.fontSize = '12px';
        backButton.onclick = returnToUnitViewFail;
        
        // Create a flex container for title and button
        const headerContainer = document.createElement('div');
        headerContainer.className = 'flex items-center justify-between mb-4';
        
        const titleContainer = document.createElement('div');
        titleContainer.className = 'flex items-center';
        titleContainer.appendChild(titleElement.cloneNode(true));
        titleContainer.appendChild(backButton);
        
        headerContainer.appendChild(titleContainer);
        
        // Replace the original title
        titleElement.parentNode.replaceChild(headerContainer, titleElement);
    }
}

// Drill down to show model-level production data for a specific unit
function drillDownToUnitModelsProduction(unitName) {
    const unitDataObj = unitData[unitName];
    if (!unitDataObj) return;

    // Store original data for returning back
    productionChartDrilldownState.originalData = {
        labels: totalSuccessChart.data.labels.slice(),
        data: totalSuccessChart.data.datasets[0].data.slice(),
        backgroundColor: totalSuccessChart.data.datasets[0].backgroundColor.slice(),
        borderColor: totalSuccessChart.data.datasets[0].borderColor.slice(),
        title: 'Toplam Üretim'
    };
    
    productionChartDrilldownState.isInDrilldown = true;
    productionChartDrilldownState.selectedUnit = unitName;

    // Get model data
    const models = unitDataObj.models || [];
    
    if (models.length === 0) {
        console.log('No model data available for unit:', unitName);
        return;
    }

    // Calculate production quantities for each model
    const modelData = models.map(model => {
        return {
            name: model.model || 'Unknown Model',
            successQty: model.success_qty || 0
        };
    });

    // Sort models by production quantity descending
    modelData.sort((a, b) => b.successQty - a.successQty);

    // Colors for models
    const modelColors = [
        '#3B82F6', '#1D4ED8', '#1E40AF', '#1E3A8A', 
        '#1F2937', '#60A5FA', '#93C5FD', '#DBEAFE',
        '#EFF6FF', '#F0F9FF', '#10B981', '#059669'
    ];

    // Update production chart with model data
    totalSuccessChart.data.labels = modelData.map(m => m.name);
    totalSuccessChart.data.datasets[0].data = modelData.map(m => m.successQty);
    totalSuccessChart.data.datasets[0].backgroundColor = modelColors.slice(0, modelData.length);
    totalSuccessChart.data.datasets[0].borderColor = modelColors.slice(0, modelData.length);
    totalSuccessChart.data.datasets[0].label = `${unitName} - Model Üretim`;
    
    totalSuccessChart.update('active');

    // Update chart title and add back button
    updateProductionChartTitle(`${unitName} - Model Üretim Detayı`, true);
}

// Return to unit-level view for production chart
function returnToUnitViewProduction() {
    if (!productionChartDrilldownState.isInDrilldown || !productionChartDrilldownState.originalData) return;

    // Restore original data
    const originalData = productionChartDrilldownState.originalData;
    totalSuccessChart.data.labels = originalData.labels;
    totalSuccessChart.data.datasets[0].data = originalData.data;
    totalSuccessChart.data.datasets[0].backgroundColor = originalData.backgroundColor;
    totalSuccessChart.data.datasets[0].borderColor = originalData.borderColor;
    totalSuccessChart.data.datasets[0].label = 'Toplam Üretim';
    
    totalSuccessChart.update('active');

    // Reset drill-down state
    productionChartDrilldownState.isInDrilldown = false;
    productionChartDrilldownState.selectedUnit = null;
    productionChartDrilldownState.originalData = null;

    // Update chart title and remove back button
    updateProductionChartTitle('Toplam Üretim', false);
}

// Update production chart title and back button
function updateProductionChartTitle(title, showBackButton) {
    const productionChartContainer = document.querySelector('#totalSuccessChart').closest('.bg-white');
    if (!productionChartContainer) return;

    let titleElement = productionChartContainer.querySelector('h3');
    if (!titleElement) return;

    // Remove existing back button if any
    const existingBackButton = productionChartContainer.querySelector('.production-back-button');
    if (existingBackButton) {
        existingBackButton.remove();
    }

    // Update title
    titleElement.textContent = title;

    // Add back button if needed
    if (showBackButton) {
        const backButton = document.createElement('button');
        backButton.className = 'production-back-button ml-2 px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors';
        backButton.textContent = '← Geri';
        backButton.style.fontSize = '12px';
        backButton.onclick = returnToUnitViewProduction;
        
        // Create a flex container for title and button
        const headerContainer = document.createElement('div');
        headerContainer.className = 'flex items-center justify-between mb-4';
        
        const titleContainer = document.createElement('div');
        titleContainer.className = 'flex items-center';
        titleContainer.appendChild(titleElement.cloneNode(true));
        titleContainer.appendChild(backButton);
        
        headerContainer.appendChild(titleContainer);
        
        // Replace the original title
        titleElement.parentNode.replaceChild(headerContainer, titleElement);
    }
}

// Drill down to show model-level performance data for a specific unit
function drillDownToUnitModelsPerformance(unitName) {
    const unitDataObj = unitData[unitName];
    if (!unitDataObj) return;

    // Store original data for returning back
    performanceChartDrilldownState.originalData = {
        labels: performanceChart.data.labels.slice(),
        data: performanceChart.data.datasets[0].data.slice(),
        backgroundColor: performanceChart.data.datasets[0].backgroundColor.slice(),
        borderColor: performanceChart.data.datasets[0].borderColor.slice(),
        title: 'OEE (%)'
    };
    
    performanceChartDrilldownState.isInDrilldown = true;
    performanceChartDrilldownState.selectedUnit = unitName;

    // Get model data
    const models = unitDataObj.models || [];
    
    if (models.length === 0) {
        console.log('No model data available for unit:', unitName);
        return;
    }

    // Calculate performance for each model
    const modelData = models.map(model => {
        let performance = 0;
        if (model.performance !== null && model.performance !== undefined) {
            performance = model.performance * 100; // Convert to percentage
        }
        return {
            name: model.model || 'Unknown Model',
            performance: performance
        };
    });

    // Sort models by performance descending
    modelData.sort((a, b) => b.performance - a.performance);

    // Colors for models (green tones for performance)
    const modelColors = [
        '#10B981', '#059669', '#047857', '#065F46', 
        '#064E3B', '#34D399', '#6EE7B7', '#A7F3D0',
        '#D1FAE5', '#ECFDF5', '#3B82F6', '#1D4ED8'
    ];

    // Update performance chart with model data
    performanceChart.data.labels = modelData.map(m => m.name);
    performanceChart.data.datasets[0].data = modelData.map(m => m.performance);
    performanceChart.data.datasets[0].backgroundColor = modelColors.slice(0, modelData.length);
    performanceChart.data.datasets[0].borderColor = modelColors.slice(0, modelData.length);
    performanceChart.data.datasets[0].label = `${unitName} - Model Performance (%)`;
    
    performanceChart.update('active');

    // Update chart title and add back button
    updatePerformanceChartTitle(`${unitName} - Model Performance Detayı`, true);
}

// Return to unit-level view for performance chart
function returnToUnitViewPerformance() {
    if (!performanceChartDrilldownState.isInDrilldown || !performanceChartDrilldownState.originalData) return;

    // Restore original data
    const originalData = performanceChartDrilldownState.originalData;
    performanceChart.data.labels = originalData.labels;
    performanceChart.data.datasets[0].data = originalData.data;
    performanceChart.data.datasets[0].backgroundColor = originalData.backgroundColor;
    performanceChart.data.datasets[0].borderColor = originalData.borderColor;
    performanceChart.data.datasets[0].label = 'OEE (%)';
    
    performanceChart.update('active');

    // Reset drill-down state
    performanceChartDrilldownState.isInDrilldown = false;
    performanceChartDrilldownState.selectedUnit = null;
    performanceChartDrilldownState.originalData = null;

    // Update chart title and remove back button
    updatePerformanceChartTitle('OEE (%)', false);
}

// Update performance chart title and back button
function updatePerformanceChartTitle(title, showBackButton) {
    const performanceChartContainer = document.querySelector('#performanceChart').closest('.bg-white');
    if (!performanceChartContainer) return;

    let titleElement = performanceChartContainer.querySelector('h3');
    if (!titleElement) return;

    // Remove existing back button if any
    const existingBackButton = performanceChartContainer.querySelector('.performance-back-button');
    if (existingBackButton) {
        existingBackButton.remove();
    }

    // Update title
    titleElement.textContent = title;

    // Add back button if needed
    if (showBackButton) {
        const backButton = document.createElement('button');
        backButton.className = 'performance-back-button ml-2 px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors';
        backButton.textContent = '← Geri';
        backButton.style.fontSize = '12px';
        backButton.onclick = returnToUnitViewPerformance;
        
        // Create a flex container for title and button
        const headerContainer = document.createElement('div');
        headerContainer.className = 'flex items-center justify-between mb-4';
        
        const titleContainer = document.createElement('div');
        titleContainer.className = 'flex items-center';
        titleContainer.appendChild(titleElement.cloneNode(true));
        titleContainer.appendChild(backButton);
        
        headerContainer.appendChild(titleContainer);
        
        // Replace the original title
        titleElement.parentNode.replaceChild(headerContainer, titleElement);
    }
} 