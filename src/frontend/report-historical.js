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

// Unit data storage
let unitData = {};

// Current sort metric and order
let currentSortMetric = 'totalSuccess';
let currentSortOrder = 'desc';

// UI elements
let loadingIndicator;
let chartsContainer;
let selectedUnitsDisplay;
let timeRangeDisplay;
let lastUpdateTimeElement;
let summaryContainer;

// Working mode configurations
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
    
    console.log('[HISTORICAL REPORT] Parameters:', {
        units: selectedUnits,
        start: startTime.toISOString(),
        end: endTime.toISOString(),
        preset: timePresetValue,
        workingMode: workingModeValue
    });
    
    // Update UI with parameters
    updateSelectedUnitsDisplay();
    updateTimeDisplay();
    updateLastUpdateTime();
    
    // Setup sort functionality for summary cards
    setupSortingEventListeners();
    
    // Load historical data
    loadHistoricalData();
});

// Setup sorting event listeners for summary cards
function setupSortingEventListeners() {
    const summaryCards = [
        { element: document.querySelector('.bg-yellow-100'), metric: 'totalSuccess', name: 'Toplam Üretim' },
        { element: document.querySelector('.bg-red-100'), metric: 'totalFail', name: 'Toplam Tamir' },
        { element: document.querySelector('#summary-container .bg-green-100'), metric: 'quality', name: 'Kalite' },
        { element: document.querySelector('#summary-container .bg-blue-100'), metric: 'performance', name: 'Performance' }
    ];
    
    summaryCards.forEach(card => {
        if (card.element) {
            card.element.style.cursor = 'pointer';
            card.element.style.transition = 'transform 0.2s, box-shadow 0.2s';
            
            card.element.addEventListener('mouseenter', () => {
                card.element.style.transform = 'scale(1.02)';
                card.element.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
            });
            
            card.element.addEventListener('mouseleave', () => {
                card.element.style.transform = 'scale(1)';
                card.element.style.boxShadow = 'none';
            });
            
            card.element.addEventListener('click', () => {
                if (currentSortMetric === card.metric) {
                    currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
                } else {
                    currentSortMetric = card.metric;
                    currentSortOrder = 'desc';
                }
                
                updateSortIndicators();
                updateCharts();
                
                console.log(`[HISTORICAL REPORT] Sorting by ${card.name} (${card.metric}) in ${currentSortOrder} order`);
            });
        }
    });
    
    updateSortIndicators();
}

// Update visual indicators for current sort
function updateSortIndicators() {
    document.querySelectorAll('.sort-indicator').forEach(el => el.remove());
    
    const metricToSelector = {
        'totalSuccess': '.bg-yellow-100',
        'totalFail': '.bg-red-100',
        'quality': '#summary-container .bg-green-100',
        'performance': '#summary-container .bg-blue-100'
    };
    
    const currentCard = document.querySelector(metricToSelector[currentSortMetric]);
    if (currentCard) {
        const indicator = document.createElement('div');
        indicator.className = 'sort-indicator absolute top-2 right-2 text-xs font-bold';
        indicator.innerHTML = currentSortOrder === 'desc' ? '↓' : '↑';
        indicator.style.position = 'absolute';
        indicator.style.top = '8px';
        indicator.style.right = '8px';
        indicator.style.fontSize = '16px';
        indicator.style.fontWeight = 'bold';
        
        if (getComputedStyle(currentCard).position === 'static') {
            currentCard.style.position = 'relative';
        }
        
        currentCard.appendChild(indicator);
        currentCard.style.border = '2px solid rgba(59, 130, 246, 0.5)';
    }
    
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
    const unitMetricsWithNames = selectedUnits.map(unit => ({
        name: unit,
        metrics: calculateUnitMetrics(unit)
    }));
    
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

// Update time range display
function updateTimeDisplay() {
    let timeRangeText = `${formatDateForDisplay(startTime)} - ${formatDateForDisplay(endTime)}`;
    
    if (timePresetValue && workingModeValue) {
        const shifts = workingModes[workingModeValue].shifts;
        const shiftConfig = shifts.find(s => s.id === timePresetValue);
        
        if (shiftConfig) {
            const workingModeName = workingModes[workingModeValue].name;
            const presetName = `${workingModeName} - Vardiya: ${shiftConfig.name}`;
            timeRangeText = `${presetName} | ${timeRangeText}`;
        }
    }
    
    timeRangeText = `📊 Geçmiş Veri: ${timeRangeText}`;
    
    if (timeRangeDisplay) {
        timeRangeDisplay.textContent = timeRangeText;
        timeRangeDisplay.style.color = '#6B7280';
        timeRangeDisplay.style.fontStyle = 'italic';
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

// Update last update time for historical data
function updateLastUpdateTime() {
    lastUpdateTimeElement.textContent = `Geçmiş veri: ${formatDateForDisplay(endTime)}`;
}

// Load historical data for all units
function loadHistoricalData() {
    loadingIndicator.classList.remove('hidden');
    
    let completedRequests = 0;
    const totalRequests = selectedUnits.length;
    
    function checkAllRequestsCompleted() {
        completedRequests++;
        if (completedRequests === totalRequests) {
            console.log('[HISTORICAL REPORT] All data loaded, creating charts');
            loadingIndicator.classList.add('hidden');
            summaryContainer.classList.remove('hidden');
            chartsContainer.classList.remove('hidden');
            createCharts();
        }
    }
    
    selectedUnits.forEach(unitName => {
        fetchHistoricalReportData(unitName, startTime, endTime, (data) => {
            if (data) {
                unitData[unitName] = data;
                console.log(`[HISTORICAL REPORT] Data loaded for ${unitName}:`, data);
            } else {
                console.error(`[HISTORICAL REPORT] Failed to load data for ${unitName}`);
                unitData[unitName] = null;
            }
            checkAllRequestsCompleted();
        });
    });
}

// Fetch historical report data using HTTP endpoint
function fetchHistoricalReportData(unitName, startTime, endTime, callback) {
    const url = new URL(`/historical-data/${encodeURIComponent(unitName)}`, window.location.origin);
    url.searchParams.append('start_time', startTime.toISOString());
    url.searchParams.append('end_time', endTime.toISOString());
    url.searchParams.append('working_mode', workingModeValue || 'mode1');
    
    console.log(`[HISTORICAL REPORT] Fetching data for ${unitName} from:`, url.toString());
    
    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            console.log(`[HISTORICAL REPORT] Received data for "${unitName}":`, data);
            callback(data);
        })
        .catch(error => {
            console.error(`[HISTORICAL REPORT] Error fetching data for "${unitName}":`, error);
            callback(null);
        });
}

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
    
    if (unitDataObj.summary) {
        return {
            totalSuccess: unitDataObj.summary.total_success || 0,
            totalFail: unitDataObj.summary.total_fail || 0,
            quality: (unitDataObj.summary.total_quality || 0) * 100,
            performance: (unitDataObj.summary.total_performance || 0) * 100
        };
    }
    
    // Check if backend provided unit_performance_sum (new calculation)
    if (unitDataObj.unit_performance_sum !== undefined) {
        return {
            totalSuccess: unitDataObj.total_success || 0,
            totalFail: unitDataObj.total_fail || 0,
            quality: (unitDataObj.total_quality || 0) * 100,
            performance: (unitDataObj.unit_performance_sum || 0) * 100
        };
    }
    
    const data = unitDataObj.models || unitDataObj || [];
    
    if (data.length === 0) {
        return {
            totalSuccess: 0,
            totalFail: 0,
            quality: 0,
            performance: 0
        };
    }
    
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

function createCharts() {
    const sortedData = getSortedUnitData();
    const unitNames = sortedData.unitNames;
    const unitMetrics = sortedData.unitMetrics;
    
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
                    ticks: { stepSize: 1 }
                }
            },
            plugins: { legend: { display: false } }
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
                    ticks: { stepSize: 1 }
                }
            },
            plugins: { legend: { display: false } }
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
            plugins: { legend: { display: false } }
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
            plugins: { legend: { display: false } }
        }
    });
    
    updateSummaryStatistics(unitMetrics);
    updateSortIndicators();
}

function updateCharts() {
    if (!totalSuccessChart) return;
    
    const sortedData = getSortedUnitData();
    const unitNames = sortedData.unitNames;
    const unitMetrics = sortedData.unitMetrics;
    
    totalSuccessChart.data.labels = unitNames;
    totalFailChart.data.labels = unitNames;
    qualityChart.data.labels = unitNames;
    performanceChart.data.labels = unitNames;
    
    totalSuccessChart.data.datasets[0].data = unitMetrics.map(m => m.totalSuccess);
    totalFailChart.data.datasets[0].data = unitMetrics.map(m => m.totalFail);
    qualityChart.data.datasets[0].data = unitMetrics.map(m => m.quality);
    performanceChart.data.datasets[0].data = unitMetrics.map(m => m.performance);
    
    totalSuccessChart.update('none');
    totalFailChart.update('none');
    qualityChart.update('none');
    performanceChart.update('none');
    
    updateSummaryStatistics(unitMetrics);
}

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
    
    document.getElementById('total-success').textContent = totalSuccess.toLocaleString();
    document.getElementById('total-fail').textContent = totalFail.toLocaleString();
    document.getElementById('avg-quality').textContent = avgQuality.toFixed(0);
    document.getElementById('avg-performance').textContent = avgPerformance.toFixed(0);
} 