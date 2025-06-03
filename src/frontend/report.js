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
    
    // Load data and create charts
    loadData();
    
    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        for (const unitName in unitSockets) {
            if (unitSockets[unitName]) {
                unitSockets[unitName].close();
            }
        }
    });
});

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
    
    // Check if this is historical data
    const now = new Date();
    const timeDifference = now.getTime() - endTime.getTime();
    const fiveMinutesInMs = 5 * 60 * 1000; // 5 minutes in milliseconds
    const isHistorical = timeDifference > fiveMinutesInMs;
    
    // Enhanced debug logging for historical data detection
    console.log('=== REPORT VIEW HISTORICAL DATA DETECTION DEBUG ===');
    console.log('Current time (now):', now);
    console.log('Current time ISO:', now.toISOString());
    console.log('End time from URL:', endTime);
    console.log('End time ISO:', endTime ? endTime.toISOString() : 'null');
    console.log('Start time from URL:', startTime);
    console.log('Start time ISO:', startTime ? startTime.toISOString() : 'null');
    console.log('Time difference (ms):', timeDifference);
    console.log('Time difference (minutes):', Math.round(timeDifference / (1000 * 60)));
    console.log('Five minutes threshold (ms):', fiveMinutesInMs);
    console.log('Is Historical?:', isHistorical);
    console.log('timeRangeDisplay element exists?:', !!timeRangeDisplay);
    console.log('URL search params:', window.location.search);
    console.log('=======================================================');

    if (timePresetValue && workingModeValue) {
        const shifts = workingModes[workingModeValue].shifts;
        const shiftConfig = shifts.find(s => s.id === timePresetValue);
        
        if (shiftConfig) {
            const workingModeName = workingModes[workingModeValue].name;
            const presetName = `${workingModeName} - Vardiya: ${shiftConfig.name}`;
            timeRangeText = `${presetName} | ${timeRangeText}`;
        }
    }
    
    // Update the real-time indicator based on historical data
    const realTimeIndicator = document.getElementById('real-time-indicator');
    if (realTimeIndicator) {
        if (isHistorical) {
            // Historical data - show historical indicator
            realTimeIndicator.className = 'flex items-center px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium';
            realTimeIndicator.innerHTML = `
                <span class="h-2 w-2 mr-2 rounded-full bg-gray-500"></span>
                Geçmiş
            `;
            console.log('REPORT VIEW: Updated real-time indicator to HISTORICAL');
        } else {
            // Live data - show live indicator
            realTimeIndicator.className = 'flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium';
            realTimeIndicator.innerHTML = `
                <span class="h-2 w-2 mr-2 rounded-full bg-green-500 animate-pulse"></span>
                Canlı
            `;
            console.log('REPORT VIEW: Updated real-time indicator to LIVE');
        }
    }
    
    // Add historical indicator
    if (isHistorical) {
        timeRangeText = `📊 Geçmiş Veri: ${timeRangeText}`;
        console.log('REPORT VIEW: Setting HISTORICAL indicator:', timeRangeText);
        // Change the display style to indicate historical data
        if (timeRangeDisplay) {
            timeRangeDisplay.style.color = '#6B7280'; // Gray color for historical
            timeRangeDisplay.style.fontStyle = 'italic';
        }
    } else {
        timeRangeText = `🟢 Canlı Veri: ${timeRangeText}`;
        console.log('REPORT VIEW: Setting LIVE indicator:', timeRangeText);
        // Reset style for live data
        if (timeRangeDisplay) {
            timeRangeDisplay.style.color = '#1F2937'; // Normal dark color
            timeRangeDisplay.style.fontStyle = 'normal';
        }
    }
    
    if (timeRangeDisplay) {
        timeRangeDisplay.textContent = timeRangeText;
        console.log('REPORT VIEW: Updated timeRangeDisplay.textContent to:', timeRangeDisplay.textContent);
    } else {
        console.error('REPORT VIEW: timeRangeDisplay element is null!');
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

// Update last update time
function updateLastUpdateTime() {
    const now = new Date();
    
    // Check if this is historical data
    const timeDifference = now.getTime() - endTime.getTime();
    const fiveMinutesInMs = 5 * 60 * 1000; // 5 minutes in milliseconds
    const isHistorical = timeDifference > fiveMinutesInMs;
    
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    if (isHistorical) {
        lastUpdateTimeElement.textContent = `Geçmiş veri: ${formatDateForDisplay(endTime)}`;
    } else {
        lastUpdateTimeElement.textContent = `Son güncelleme: ${hours}:${minutes}:${seconds}`;
    }
    
    // Only apply flash effects for live data, not historical data
    if (!isHistorical) {
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
    } else {
        // Clear the flash elements array for historical data
        elementsToFlashOnUpdate = [];
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
    
    function sendDataRequest() {
        if (unitSocket.readyState === WebSocket.OPEN) {
            // Check if this is historical data
            const now = new Date();
            const timeDifference = now.getTime() - endTime.getTime();
            const fiveMinutesInMs = 5 * 60 * 1000; // 5 minutes in milliseconds
            const isHistorical = timeDifference > fiveMinutesInMs;
            
            // For historical data, don't send periodic updates after initial load
            if (isHistorical && hasReceivedInitialData) {
                console.log(`[HISTORICAL DATA] Skipping periodic update for historical data for "${unitName}"`);
                return;
            }
            
            // For historical data, use the original end time; for live data, use current time
            const currentEndTime = isHistorical ? endTime : new Date();
            const params = {
                start_time: startTime.toISOString(),
                end_time: currentEndTime.toISOString(),
                working_mode: workingModeValue || 'mode1'
            };
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
        sendDataRequest();
        updateInterval = setInterval(sendDataRequest, 30000); // Update every 30 seconds
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
                    // Show update indicator
                    updateIndicator.classList.remove('hidden');
                    
                    // Update charts with new data
                    updateCharts();
                    updateLastUpdateTime();
                    
                    // Hide update indicator after a brief moment
                    setTimeout(() => {
                        updateIndicator.classList.add('hidden');
                    }, 1000);
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
    
    // Check if we have backend-calculated summary
    if (unitDataObj.summary) {
        // Use backend-calculated values
        return {
            totalSuccess: unitDataObj.summary.total_success || 0,
            totalFail: unitDataObj.summary.total_fail || 0,
            quality: (unitDataObj.summary.total_quality || 0) * 100,
            performance: (unitDataObj.summary.total_performance || 0) * 100
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
    
    // Get performance from backend-calculated model values (all should be same)
    const modelsWithTarget = data.filter(model => model.target && model.target > 0 && model.performance !== null && model.performance !== undefined);
    let performance = 0;
    
    if (modelsWithTarget.length > 0) {
        // Use backend-calculated performance (all models should have same value)
        performance = modelsWithTarget[0].performance;
    }
    
    return {
        totalSuccess: totalSuccess,
        totalFail: totalFail,
        quality: quality * 100,
        performance: performance * 100
    };
}

// Create charts
function createCharts() {
    const unitNames = selectedUnits;
    const unitMetrics = unitNames.map(unit => calculateUnitMetrics(unit));
    
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
            }
        }
    });
    
    // Update summary statistics
    updateSummaryStatistics(unitMetrics);
}

// Update charts with new data
function updateCharts() {
    if (!totalSuccessChart) return;
    
    const unitNames = selectedUnits;
    const unitMetrics = unitNames.map(unit => calculateUnitMetrics(unit));
    
    // Update chart data
    totalSuccessChart.data.datasets[0].data = unitMetrics.map(m => m.totalSuccess);
    totalFailChart.data.datasets[0].data = unitMetrics.map(m => m.totalFail);
    qualityChart.data.datasets[0].data = unitMetrics.map(m => m.quality);
    performanceChart.data.datasets[0].data = unitMetrics.map(m => m.performance);
    
    // Update charts
    totalSuccessChart.update('none');
    totalFailChart.update('none');
    qualityChart.update('none');
    performanceChart.update('none');
    
    // Update summary statistics
    updateSummaryStatistics(unitMetrics);
}

// Update summary statistics
function updateSummaryStatistics(unitMetrics) {
    const totalSuccess = unitMetrics.reduce((sum, m) => sum + m.totalSuccess, 0);
    const totalFail = unitMetrics.reduce((sum, m) => sum + m.totalFail, 0);
    const avgQuality = unitMetrics.length > 0 ? 
        unitMetrics.reduce((sum, m) => sum + m.quality, 0) / unitMetrics.length : 0;
    const avgPerformance = unitMetrics.length > 0 ? 
        unitMetrics.reduce((sum, m) => sum + m.performance, 0) / unitMetrics.length : 0;
    
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
    const newAvgPerformance = avgPerformance.toFixed(1);
    if (oldAvgPerformance !== newAvgPerformance) {
        avgPerformanceElement.textContent = newAvgPerformance;
        elementsToFlashOnUpdate.push(avgPerformanceElement);
    }
} 