// Global WebSocket connection
let socket = null;

// DOM Elements
const dashboardForm = document.getElementById('dashboard-form');
const unitsContainer = document.getElementById('units-container');
const startTimeInput = document.getElementById('start-time');
const endTimeInput = document.getElementById('end-time');
const loadingIndicator = document.getElementById('loading-indicator');
const summaryContainer = document.getElementById('summary-container');
const totalProduction = document.getElementById('total-production');
const totalQuality = document.getElementById('total-quality');
const totalPerformance = document.getElementById('total-performance');
const totalOEE = document.getElementById('total-oee');
const standardViewBtn = document.getElementById('standard-view-btn');
const hourlyViewBtn = document.getElementById('hourly-view-btn');
const reportViewBtn = document.getElementById('report-view-btn');

// Track the selected units
let selectedUnits = [];

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

// Function to get current working mode
function getCurrentWorkingMode() {
    const selectedMode = document.querySelector('input[name="working-mode"]:checked');
    return selectedMode ? selectedMode.value : 'mode1';
}

// Function to determine current shift based on working mode
function getCurrentShift() {
    const currentHour = new Date().getHours();
    const workingMode = getCurrentWorkingMode();
    const shifts = workingModes[workingMode].shifts;
    
    for (const shift of shifts) {
        if (shift.crossesMidnight) {
            // For shifts that cross midnight (e.g., 20:00 - 08:00)
            if (currentHour >= shift.start || currentHour < shift.end) {
                return shift.id;
            }
        } else {
            // For regular shifts
            if (currentHour >= shift.start && currentHour < shift.end) {
                return shift.id;
            }
        }
    }
    
    // Default to first shift if no match
    return shifts[0].id;
}

// Function to populate shifts based on working mode
function populateShifts(workingMode = 'mode1') {
    const shiftContainer = document.getElementById('shift-container');
    const shifts = workingModes[workingMode].shifts;
    
    shiftContainer.innerHTML = '';
    
    shifts.forEach(shift => {
        const shiftElement = document.createElement('div');
        shiftElement.className = 'flex items-center px-3 py-2 border border-gray-300 rounded-md bg-white hover:border-blue-600';
        
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.id = `time-preset-${shift.id}`;
        radio.name = 'time-preset';
        radio.value = shift.id;
        radio.className = 'h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500';
        radio.addEventListener('change', handleTimePresetChange);
        
        const label = document.createElement('label');
        label.htmlFor = `time-preset-${shift.id}`;
        label.className = 'ml-2 block text-sm text-gray-900';
        label.textContent = shift.name;
        
        shiftElement.appendChild(radio);
        shiftElement.appendChild(label);
        shiftContainer.appendChild(shiftElement);
    });
    
    // Select current shift by default
    const currentShift = getCurrentShift();
    const currentShiftRadio = document.getElementById(`time-preset-${currentShift}`);
    if (currentShiftRadio) {
        currentShiftRadio.checked = true;
        handleTimePresetChange({ target: { value: currentShift } });
    }
}

// Initialize date/time pickers with default values
function initializeDateTimePickers() {
    const now = new Date();
    const workingMode = getCurrentWorkingMode();
    const currentShift = getCurrentShift();
    const shifts = workingModes[workingMode].shifts;
    const shiftConfig = shifts.find(s => s.id === currentShift);
    
    if (!shiftConfig) return;
    
    let shiftStartTime, shiftEndTime;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    if (shiftConfig.crossesMidnight) {
        // For shifts that cross midnight
        const currentHour = now.getHours();
        if (currentHour >= shiftConfig.start) {
            // We're in the first part of the shift (before midnight)
            shiftStartTime = new Date(today.setHours(shiftConfig.start, 0, 0, 0));
        } else {
            // We're in the second part of the shift (after midnight)
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            shiftStartTime = new Date(yesterday.setHours(shiftConfig.start, 0, 0, 0));
        }
    } else {
        // For regular shifts
        shiftStartTime = new Date(today.setHours(shiftConfig.start, 0, 0, 0));
    }
    
    // Set the inputs with the current shift times
    startTimeInput.value = formatDateTimeForInput(shiftStartTime);
    endTimeInput.value = formatDateTimeForInput(now); // Current time for end time
}

// Format date for datetime-local input
function formatDateTimeForInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Function to determine if selected time range should be treated as live or historical
function isLiveDataRequest(startTime, endTime, selectedPreset) {
    // Decision is based ONLY on the actual end time, not the preset
    // If end time is recent (within last 5 minutes), treat as live data
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - (5 * 60 * 1000));
    
    const isLive = endTime >= fiveMinutesAgo;
    
    return isLive;
}

// Parse datetime-local input value to Date object
function parseInputDateTime(inputValue) {
    return inputValue ? new Date(inputValue) : null;
}

// Validate if selected time range is within 14-day data retention limit
function validateDataRetention(startTime, endTime) {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000)); // 14 days in milliseconds
    
    // Check if start time is more than 5 days old
    if (startTime < fourteenDaysAgo) {
        const fourteenDaysAgoStr = fourteenDaysAgo.toLocaleDateString('tr-TR', {
            day: '2-digit',
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        const startTimeStr = startTime.toLocaleDateString('tr-TR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric', 
            hour: '2-digit',
            minute: '2-digit'
        });
        
        alert(`⚠️ Uyarı: Veritabanında son 14 günlük veri işlenmektedir.\n\nSeçilen başlangıç tarihi ${fourteenDaysAgoStr}'den eski.\n\nLütfen ${fourteenDaysAgoStr} tarihinden sonra bir zaman aralığı seçiniz.`);
        return false;
    }
    
    // Check if end time is more than 5 days old  
    if (endTime < fourteenDaysAgo) {
        const fourteenDaysAgoStr = fourteenDaysAgo.toLocaleDateString('tr-TR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit', 
            minute: '2-digit'
        });
        
        const endTimeStr = endTime.toLocaleDateString('tr-TR', {
            day: '2-digit',
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        alert(`⚠️ Uyarı: Veritabanı sadece son 14 günlük veriyi saklıyor.\n\nSeçilen bitiş tarihi çok eski: ${endTimeStr}\n\nLütfen ${fourteenDaysAgoStr} tarihinden sonra bir zaman aralığı seçiniz.`);
        return false;
    }
    
    return true;
}

// Function to group units by their base name (e.g., "Final 1", "Final 2")
function groupUnitsByBase(units) {
    const grouped = {};
    
    units.forEach(unit => {
        // Extract base name (e.g., "Final 1" from "Final 1A", "Final 1B")
        let baseName;
        let side;
        
        // Handle special case for "Final 3A-2"
        if (unit === 'Final 3A-2') {
            baseName = 'Final 3';
            side = 'A';
        } else {
            // Regular pattern: extract everything except the last character(s)
            const match = unit.match(/^(.+?)([AB])$/);
            if (match) {
                baseName = match[1].trim();
                side = match[2];
            } else {
                // If no A/B suffix, treat as standalone
                baseName = unit;
                side = 'A';
            }
        }
        
        if (!grouped[baseName]) {
            grouped[baseName] = { A: [], B: [] };
        }
        
        grouped[baseName][side].push(unit);
    });
    
    return grouped;
}

// Function to create a unit checkbox element
function createUnitCheckbox(unit) {
    const unitElement = document.createElement('div');
    unitElement.className = 'flex items-center px-2 py-2 hover:bg-gray-50 hover:rounded';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'units';
    checkbox.id = `unit-${unit}`;
    checkbox.value = unit;
    checkbox.className = 'h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer flex-shrink-0';
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            // Add to selected units if not already in the array
            if (!selectedUnits.includes(unit)) {
                selectedUnits.push(unit);
            }
        } else {
            // Remove from selected units
            selectedUnits = selectedUnits.filter(u => u !== unit);
        }
        console.log('Selected units:', selectedUnits);
    });
    
    const label = document.createElement('label');
    label.htmlFor = `unit-${unit}`;
    label.className = 'ml-2 block text-sm text-gray-900 cursor-pointer';
    label.textContent = unit;
    
    unitElement.appendChild(checkbox);
    unitElement.appendChild(label);
    
    return unitElement;
}

// Fetch production units on page load
document.addEventListener('DOMContentLoaded', () => {
    // Populate shifts for default working mode
    populateShifts('mode1');
    
    // Initialize date/time pickers
    initializeDateTimePickers();
    
    // Fetch available units
    fetchProductionUnits();
    
    // Add event listeners to working mode radio buttons
    document.querySelectorAll('input[name="working-mode"]').forEach(radio => {
        radio.addEventListener('change', (event) => {
            const selectedMode = event.target.value;
            populateShifts(selectedMode);
            initializeDateTimePickers();
        });
    });
    
    // Check if no shift is selected and select current shift if needed
    setInterval(() => {
        const selectedShift = document.querySelector('input[name="time-preset"]:checked');
        if (!selectedShift || !selectedShift.value) {
            const currentShift = getCurrentShift();
            const currentShiftRadio = document.getElementById(`time-preset-${currentShift}`);
            if (currentShiftRadio) {
                currentShiftRadio.checked = true;
                handleTimePresetChange({ target: { value: currentShift } });
            }
        }
    }, 1000); // Check every second
});

// Fetch production units from API
async function fetchProductionUnits() {
    try {
        const response = await fetch('/units');
        if (!response.ok) {
            throw new Error('Failed to fetch units');
        }
        
        const units = await response.json();
        
        // Clear loading message
        unitsContainer.innerHTML = '';
        
        // Group units by their base name (e.g., "Final 1", "Final 2", "Final 3")
        const groupedUnits = groupUnitsByBase(units);
        
        // Add units as checkboxes in a smart 2-column layout with equal spacing
        Object.entries(groupedUnits).forEach(([baseName, unitGroup]) => {
            // Calculate the maximum number of units in either column for this group
            const maxUnitsInGroup = Math.max(unitGroup.A.length, unitGroup.B.length);
            
            // Create individual rows for each unit position
            for (let i = 0; i < maxUnitsInGroup; i++) {
                const rowContainer = document.createElement('div');
                rowContainer.className = 'col-span-2 grid grid-cols-2 gap-2 mb-2';
                
                // Create A column cell
                const cellA = document.createElement('div');
                if (unitGroup.A[i]) {
                    const unitElement = createUnitCheckbox(unitGroup.A[i]);
                    cellA.appendChild(unitElement);
                } else {
                    // Empty cell to maintain grid structure
                    cellA.innerHTML = '&nbsp;';
                }
                
                // Create B column cell
                const cellB = document.createElement('div');
                if (unitGroup.B[i]) {
                    const unitElement = createUnitCheckbox(unitGroup.B[i]);
                    cellB.appendChild(unitElement);
                } else {
                    // Empty cell to maintain grid structure
                    cellB.innerHTML = '&nbsp;';
                }
                
                rowContainer.appendChild(cellA);
                rowContainer.appendChild(cellB);
                unitsContainer.appendChild(rowContainer);
            }
        });
        
        // Remove default selection of first unit
        // No auto-selection as per user request
    } catch (error) {
        console.error('Error fetching units:', error);
        unitsContainer.innerHTML = '<div class="col-span-2 text-red-500">Error loading units</div>';
        
        // Add a default option if we can't load from the backend
        const unitElement = document.createElement('div');
        unitElement.className = 'flex items-center px-2 py-2 hover:bg-gray-50 hover:rounded';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'units';
        checkbox.id = 'unit-DefaultUnit';
        checkbox.value = 'DefaultUnit';
        checkbox.className = 'h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer flex-shrink-0';
        checkbox.checked = false; // Not checked by default
        
        const label = document.createElement('label');
        label.htmlFor = 'unit-DefaultUnit';
        label.className = 'ml-2 block text-sm text-gray-900 cursor-pointer';
        label.textContent = 'Default Unit';
        
        unitElement.appendChild(checkbox);
        unitElement.appendChild(label);
        
        unitsContainer.appendChild(unitElement);
        // Remove from selectedUnits array
        selectedUnits = [];
    }
}

// Handle time preset selection
function handleTimePresetChange(event) {
    const presetValue = event.target.value;
    const now = new Date();
    const workingMode = getCurrentWorkingMode();
    const shifts = workingModes[workingMode].shifts;
    const shiftConfig = shifts.find(s => s.id === presetValue);
    
    // If no preset is selected, use current shift
    if (!presetValue || !shiftConfig) {
        const currentShift = getCurrentShift();
        const currentShiftRadio = document.getElementById(`time-preset-${currentShift}`);
        if (currentShiftRadio) {
            currentShiftRadio.checked = true;
            handleTimePresetChange({ target: { value: currentShift } });
        }
        return;
    }
    
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let shiftStartTime, shiftEndTime;
    
    if (shiftConfig.crossesMidnight) {
        // For shifts that cross midnight (e.g., 20:00 - 08:00)
        const currentHour = now.getHours();
        
        if (currentHour >= shiftConfig.start) {
            // We're in the first part of the shift (before midnight)
            shiftStartTime = new Date(today.setHours(shiftConfig.start, 0, 0, 0));
            // End time is next day at shift end hour
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            shiftEndTime = new Date(tomorrow.setHours(shiftConfig.end, 0, 0, 0));
        } else if (currentHour < shiftConfig.end) {
            // We're in the second part of the shift (after midnight)
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            shiftStartTime = new Date(yesterday.setHours(shiftConfig.start, 0, 0, 0));
            shiftEndTime = new Date(today.setHours(shiftConfig.end, 0, 0, 0));
        } else {
            // Current time is between shifts, use today's shift start
            shiftStartTime = new Date(today.setHours(shiftConfig.start, 0, 0, 0));
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            shiftEndTime = new Date(tomorrow.setHours(shiftConfig.end, 0, 0, 0));
        }
        
        // For end time, use current time if we're within the shift, otherwise use shift end
        if ((currentHour >= shiftConfig.start) || (currentHour < shiftConfig.end)) {
            endTimeInput.value = formatDateTimeForInput(now);
        } else {
            endTimeInput.value = formatDateTimeForInput(shiftEndTime);
        }
    } else {
        // For regular shifts that don't cross midnight
        shiftStartTime = new Date(today.setHours(shiftConfig.start, 0, 0, 0));
        shiftEndTime = new Date(today.setHours(shiftConfig.end, 0, 0, 0));
        
        // For end time, use current time if we're within the shift, otherwise use shift end
        const currentHour = now.getHours();
        if (currentHour >= shiftConfig.start && currentHour < shiftConfig.end) {
            endTimeInput.value = formatDateTimeForInput(now);
        } else {
            endTimeInput.value = formatDateTimeForInput(shiftEndTime);
        }
    }
    
    startTimeInput.value = formatDateTimeForInput(shiftStartTime);
}

// Handle standard view button click
standardViewBtn.addEventListener('click', () => {
    // Validate inputs
    const startTime = parseInputDateTime(startTimeInput.value);
    const endTime = parseInputDateTime(endTimeInput.value);
    
    if (!startTime || !endTime) {
        alert('Lütfen geçerli bir başlangıç ve bitiş zamanı seçiniz');
        return;
    }
    
    // Check 5-day data retention limit
    if (!validateDataRetention(startTime, endTime)) {
        return;
    }
    
    if (selectedUnits.length === 0) {
        alert('Lütfen en az bir üretim yerini seçiniz');
        return;
    }
    
    // Get selected preset
    const selectedPreset = document.querySelector('input[name="time-preset"]:checked');
    const presetValue = selectedPreset ? selectedPreset.value : null;
    
    // Determine if this should be live or historical data
    const isLive = isLiveDataRequest(startTime, endTime, presetValue);
    
    // Create URL parameters
    const params = new URLSearchParams();
    
    // Add selected units
    selectedUnits.forEach(unit => {
        params.append('units', unit);
    });
    
    // Add time parameters
    params.append('start', startTime.toISOString());
    params.append('end', endTime.toISOString());
    
    // Add working mode
    const selectedWorkingMode = document.querySelector('input[name="working-mode"]:checked');
    if (selectedWorkingMode && selectedWorkingMode.value) {
        params.append('workingMode', selectedWorkingMode.value);
    }
    
    // Add preset if available
    if (presetValue) {
        params.append('preset', presetValue);
    }
    
    // Choose the appropriate page based on live vs historical
    const pageUrl = isLive ? '/standart.html' : '/standart-historical.html';
    
    console.log(`[ROUTING] Opening ${isLive ? 'LIVE' : 'HISTORICAL'} standard view: ${pageUrl}`);
    
    // Open in new window with explicit _blank target to ensure it always opens in a new window
    const newWindow = window.open(`${pageUrl}?${params.toString()}`, '_blank');
    if (newWindow) {
        // If successful, focus the new window
        newWindow.focus();
    } else {
        // If popup was blocked, alert the user
        alert('Tarayıcınızda pop-up engellendi. Lütfen bu site için pop-uplara izin veriniz.');
    }
});

// Handle hourly view button click
hourlyViewBtn.addEventListener('click', () => {
    // Validate inputs
    const startTime = parseInputDateTime(startTimeInput.value);
    const endTime = parseInputDateTime(endTimeInput.value);
    
    if (!startTime || !endTime) {
        alert('Lütfen geçerli bir başlangıç ve bitiş zamanı seçiniz');
        return;
    }
    
    // Check 5-day data retention limit
    if (!validateDataRetention(startTime, endTime)) {
        return;
    }
    
    if (selectedUnits.length === 0) {
        alert('Lütfen en az bir üretim yerini seçiniz');
        return;
    }
    
    // Get selected preset
    const selectedPreset = document.querySelector('input[name="time-preset"]:checked');
    const presetValue = selectedPreset ? selectedPreset.value : null;
    
    // Determine if this should be live or historical data
    const isLive = isLiveDataRequest(startTime, endTime, presetValue);
    
    // Create URL parameters
    const params = new URLSearchParams();
    
    // Add selected units
    selectedUnits.forEach(unit => {
        params.append('units', unit);
    });
    
    // Add time parameters
    params.append('start', startTime.toISOString());
    params.append('end', endTime.toISOString());
    
    // Add working mode
    const selectedWorkingMode = document.querySelector('input[name="working-mode"]:checked');
    if (selectedWorkingMode && selectedWorkingMode.value) {
        params.append('workingMode', selectedWorkingMode.value);
    }
    
    // Add preset if available
    if (presetValue) {
        params.append('preset', presetValue);
    }
    
    // Choose the appropriate page based on live vs historical
    const pageUrl = isLive ? '/hourly.html' : '/hourly-historical.html';
    
    console.log(`[ROUTING] Opening ${isLive ? 'LIVE' : 'HISTORICAL'} hourly view: ${pageUrl}`);
    
    // Open in new window with explicit _blank target to ensure it always opens in a new window
    const newWindow = window.open(`${pageUrl}?${params.toString()}`, '_blank');
    if (newWindow) {
        // If successful, focus the new window
        newWindow.focus();
    } else {
        // If popup was blocked, alert the user
        alert('Tarayıcınızda pop-up engellendi. Lütfen bu site için pop-uplara izin veriniz.');
    }
});

// Handle report view button click
reportViewBtn.addEventListener('click', () => {
    // Validate inputs
    const startTime = parseInputDateTime(startTimeInput.value);
    const endTime = parseInputDateTime(endTimeInput.value);
    
    if (!startTime || !endTime) {
        alert('Lütfen geçerli bir başlangıç ve bitiş zamanı seçiniz');
        return;
    }
    
    // Check 5-day data retention limit
    if (!validateDataRetention(startTime, endTime)) {
        return;
    }
    
    if (selectedUnits.length === 0) {
        alert('Lütfen en az bir üretim yerini seçiniz');
        return;
    }
    
    // Get selected preset
    const selectedPreset = document.querySelector('input[name="time-preset"]:checked');
    const presetValue = selectedPreset ? selectedPreset.value : null;
    
    // Determine if this should be live or historical data
    const isLive = isLiveDataRequest(startTime, endTime, presetValue);
    
    // Create URL parameters
    const params = new URLSearchParams();
    
    // Add selected units
    selectedUnits.forEach(unit => {
        params.append('units', unit);
    });
    
    // Add time parameters
    params.append('start', startTime.toISOString());
    params.append('end', endTime.toISOString());
    
    // Add working mode
    const selectedWorkingMode = document.querySelector('input[name="working-mode"]:checked');
    if (selectedWorkingMode && selectedWorkingMode.value) {
        params.append('workingMode', selectedWorkingMode.value);
    }
    
    // Add preset if available
    if (presetValue) {
        params.append('preset', presetValue);
    }
    
    // Choose the appropriate page based on live vs historical
    const pageUrl = isLive ? '/report' : '/report-historical';
    
    // Open in new window with explicit _blank target to ensure it always opens in a new window
    const newWindow = window.open(`${pageUrl}?${params.toString()}`, '_blank');
    if (newWindow) {
        // If successful, focus the new window
        newWindow.focus();
    } else {
        // If popup was blocked, alert the user
        alert('Tarayıcınızda pop-up engellendi. Lütfen bu site için pop-uplara izin veriniz.');
    }
});