const timerDisplay = document.getElementById('timer');
const instructions = document.getElementById('instructions');
const timesList = document.getElementById('times-list');
const sessionDropdown = document.getElementById('session-dropdown');
const deleteTimesBtn = document.getElementById('delete-times');
const deleteSessionBtn = document.getElementById('delete-session');
const addSessionBtn = document.getElementById('add-session');
const sessionAverageDisplay = document.getElementById('session-average');
const sessionLowestDisplay = document.getElementById('session-lowest');
const currentSessionNameDisplay = document.getElementById('current-session-name');
const settingsButton = document.getElementById('settings-button'); // New
const settingsPanel = document.getElementById('settings-panel');   // New
const enableInspectionCheckbox = document.getElementById('enable-inspection'); // New
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');
const exportSessionBtn = document.getElementById('export-session'); // New
const renameSessionBtn = document.getElementById('rename-session'); // New

// Chart elements
const rollingAveragesChartCtx = document.getElementById('rollingAveragesChart');
const sessionTimesChartCtx = document.getElementById('sessionTimesChart');

let rollingAveragesChart = null;
let sessionTimesChart = null;

// --- Google Sheets API Config ---
const CLIENT_ID = '311111663580-oh6f55olsb3ccinsrau4c3mng8klajho.apps.googleusercontent.com';
const SPREADSHEET_ID = '10cbvAUSqstFwuHULMKxzXdD9ZV1wfDVs2H-s3hmacXk';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SPREADSHEET_LINK = 'https://docs.google.com/spreadsheets/d/10cbvAUSqstFwuHULMKxzXdD9ZV1wfDVs2H-s3hmacXk/edit?gid=499354953';

let tokenClient;
let gapiInited = false;
let gisInited = false;
// --- End Google Sheets API Config ---

let timerInterval = null;
let inspectionInterval = null;
let holdCheckInterval = null; // Interval to check if spacebar has been held long enough
let startTime = 0;
let isRunning = false;
let spacebarHeld = false;
let spacebarPressTime = 0; // Track when spacebar was pressed
let minHoldTime = 100; // Minimum hold time in milliseconds (0.2 seconds)
let holdTimeReached = false; // Flag to track if minimum hold time has been reached
let inspectionEnabled = false; // Controlled by checkbox now
let inspectionRunning = false;
let inspectionTimeLeft = 15;
let inspectionTimeout = null; // Timeout for "Inspection Over" message

// Store times and indices of times that were the lowest when added
let sessions = {};
let currentSession = null;
let sessionCounter = 1;

// --- LocalStorage Functions ---
function saveStateToLocalStorage() {
    localStorage.setItem('timerSessions', JSON.stringify(sessions));
    localStorage.setItem('timerCurrentSession', currentSession);
    localStorage.setItem('timerSessionCounter', sessionCounter.toString());
}

function loadStateFromLocalStorage() {
    const savedSessions = localStorage.getItem('timerSessions');
    const savedCurrentSession = localStorage.getItem('timerCurrentSession');
    const savedSessionCounter = localStorage.getItem('timerSessionCounter');

    if (savedSessions) {
        sessions = JSON.parse(savedSessions);
    }
    if (savedCurrentSession && sessions[savedCurrentSession]) { // Ensure saved current session exists
        currentSession = savedCurrentSession;
    } else if (Object.keys(sessions).length > 0) { // Fallback to first available session
        currentSession = Object.keys(sessions)[0];
    } // If no sessions, currentSession remains null until one is added

    if (savedSessionCounter) {
        sessionCounter = parseInt(savedSessionCounter, 10);
    }
}
// --- End LocalStorage Functions ---

function formatTime(ms) {
    const totalSeconds = ms / 1000;
    const seconds = Math.floor(totalSeconds) % 60;
    const minutes = Math.floor(totalSeconds / 60);
    const milliseconds = Math.floor(ms % 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

function updateTimer() {
    const elapsedTime = Date.now() - startTime;
    timerDisplay.textContent = formatTime(elapsedTime);
}

function startTimer() {
    if (!isRunning) {
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 10); // Update every 10ms for milliseconds precision
        isRunning = true;
        instructions.textContent = 'Press SPACEBAR or any key to stop.';
        timerDisplay.style.color = '#008000'; // Green when running
        timerDisplay.classList.remove('inspection'); // Ensure inspection style is removed
    }
}

function stopTimer() {
    if (isRunning) {
        clearInterval(timerInterval);
        const elapsedTime = Date.now() - startTime;
        timerDisplay.textContent = formatTime(elapsedTime);
        addTimeToList(elapsedTime);
        isRunning = false;
        instructions.textContent = 'Press and hold SPACEBAR to prepare, release to start.';
        timerDisplay.style.color = '#d32f2f'; // Red when stopped
        timerDisplay.classList.remove('inspection'); // Ensure inspection style is removed
        // Trigger custom event for scramble generation
        document.dispatchEvent(new CustomEvent('timerStopped'));
    }
}

function addTimeToList(ms) {
    if (sessions[currentSession]) {
        const sessionData = sessions[currentSession];
        const times = sessionData.times;
        const lowestIndices = sessionData.lowestTimesIndices;

        // Determine the minimum time *before* adding the new one
        const currentMin = times.length > 0 ? Math.min(...times) : Infinity;

        // Add the new time
        times.push(ms);
        const newIndex = times.length - 1;

        // Update lowestTimesIndices: Highlight if the new time is a record *at this point*
        if (ms <= currentMin) {
            // Add the index of this record time to the list
            lowestIndices.push(newIndex);
            // No need to clear or modify existing highlights
        }
        // If ms > currentMin, do nothing to lowestTimesIndices

        renderTimesList();
        updateStatistics();
        updatePllAlgorithmLowestTimes(); // Update PLL specific lowest times
        updateCharts(); // Update charts
        saveStateToLocalStorage(); // Save state after adding time
    }
}

// --- BO_N Calculation ---
function calculateBoN(times, n) {
    if (!times || times.length < n) {
        return null; // Not enough times for BO_N
    }

    // Get the last 'n' times from the provided array
    const relevantTimes = times.slice(-n);

    if (relevantTimes.length < 3) { // Need at least 3 times to remove best/worst and average 1
        return null;
    }

    // Sort to easily find best and worst
    const sortedTimes = [...relevantTimes].sort((a, b) => a - b);

    // Remove best (last element) and worst (first element)
    const middleTimes = sortedTimes.slice(1, -1);

    if (middleTimes.length === 0) {
        return null; // Should not happen if n >= 3
    }

    // Calculate the average of the middle times
    const sum = middleTimes.reduce((acc, time) => acc + time, 0);
    return sum / middleTimes.length;
}
// --- End BO_N Calculation ---

function renderTimesList() {
    timesList.innerHTML = ''; // Clear existing list
    if (sessions[currentSession]) {
        const sessionData = sessions[currentSession];
        const times = sessionData.times;
        const lowestIndices = sessionData.lowestTimesIndices;

        times.forEach((ms, index) => {
            const li = document.createElement('li');
            li.classList.add('time-entry');

            // Column 1: Time (as a button)
            const timeButton = document.createElement('button');
            timeButton.textContent = formatTime(ms);
            timeButton.classList.add('time-entry-button', 'time-col'); // Add 'time-col'
            if (lowestIndices.includes(index)) {
                timeButton.classList.add('lowest-time');
                li.classList.add('lowest-time-row'); // Add to li for potential full row highlight
            }
            timeButton.addEventListener('click', () => deleteSpecificTime(index));

            // Column 2: BO5
            const bo5Span = document.createElement('span');
            bo5Span.classList.add('time-entry-stat', 'bo5-col'); // Add 'bo5-col'
            const timesUpToCurrent = times.slice(0, index + 1);
            if (timesUpToCurrent.length >= 5) {
                const bo5 = calculateBoN(timesUpToCurrent, 5);
                bo5Span.textContent = bo5 !== null ? formatTime(bo5) : 'N/A';
            } else {
                bo5Span.textContent = '-'; // Placeholder for alignment
            }

            // Column 3: BO12
            const bo12Span = document.createElement('span');
            bo12Span.classList.add('time-entry-stat', 'bo12-col'); // Add 'bo12-col'
            if (timesUpToCurrent.length >= 12) {
                const bo12 = calculateBoN(timesUpToCurrent, 12);
                bo12Span.textContent = bo12 !== null ? formatTime(bo12) : 'N/A';
            } else {
                bo12Span.textContent = '-'; // Placeholder for alignment
            }

            li.appendChild(timeButton);
            li.appendChild(bo5Span);
            li.appendChild(bo12Span);
            timesList.appendChild(li);
        });
        // Scroll to the bottom of the list
        timesList.scrollTop = timesList.scrollHeight;
    }
}

function deleteSpecificTime(indexToDelete) {
    if (sessions[currentSession] && sessions[currentSession].times.length > indexToDelete) {
        const sessionData = sessions[currentSession];
        sessionData.times.splice(indexToDelete, 1); // Remove the time

        // Update lowestTimesIndices:
        // 1. Filter out the deleted index
        // 2. Decrement indices that were greater than the deleted index
        sessionData.lowestTimesIndices = sessionData.lowestTimesIndices
            .filter(idx => idx !== indexToDelete)
            .map(idx => (idx > indexToDelete ? idx - 1 : idx));

        renderTimesList();
        updateStatistics();
        updatePllAlgorithmLowestTimes(); // Update PLL specific lowest times
        updateCharts(); // Update charts
        saveStateToLocalStorage();
    }
}

function updateStatistics() {
    if (sessions[currentSession]) {
        const times = sessions[currentSession].times;
        // Find the actual lowest time value for display
        const lowestTimeValue = times.length > 0 ? Math.min(...times) : Infinity;

        if (times.length > 0) {
            const sum = times.reduce((acc, time) => acc + time, 0);
            const average = sum / times.length;
            sessionAverageDisplay.textContent = formatTime(average);
            sessionLowestDisplay.textContent = formatTime(lowestTimeValue);
        } else {
            sessionAverageDisplay.textContent = 'N/A';
            sessionLowestDisplay.textContent = 'N/A';
        }
    } else {
        sessionAverageDisplay.textContent = 'N/A';
        sessionLowestDisplay.textContent = 'N/A';
    }
}

function renderSessionDropdown() {
    sessionDropdown.innerHTML = ''; // Clear existing options
    Object.keys(sessions).forEach(sessionName => {
        const option = document.createElement('option');
        option.value = sessionName;
        option.textContent = sessionName;
        if (sessionName === currentSession) {
            option.selected = true;
        }
        sessionDropdown.appendChild(option);
    });
    // Add event listener if it doesn't exist or needs refreshing
    sessionDropdown.removeEventListener('change', handleSessionChange);
    sessionDropdown.addEventListener('change', handleSessionChange);
}

function handleSessionChange(event) {
    switchSession(event.target.value);
}

function switchSession(sessionName) {
    if (sessions[sessionName]) {
        currentSession = sessionName;
        currentSessionNameDisplay.textContent = sessionName; // Update sidebar title
        renderSessionDropdown(); // Update dropdown selection
        renderTimesList();
        updateStatistics(); // Update stats on session switch
        updatePllAlgorithmLowestTimes(); // Update PLL specific lowest times
        updateCharts(); // Update charts
        saveStateToLocalStorage(); // Save state after switching session
    }
}

function addSession(sessionName = null) {
    const newSessionName = sessionName ? sessionName : `Session ${++sessionCounter}`;
    // Check if session already exists, if so, switch to it instead of creating a duplicate
    if (sessions[newSessionName]) {
        switchSession(newSessionName);
        return; // Exit the function early
    }
    // Initialize new session structure
    sessions[newSessionName] = { times: [], lowestTimesIndices: [] };
    switchSession(newSessionName); // This will also save
    renderSessionDropdown(); // Refresh dropdown after adding
    updatePllAlgorithmLowestTimes(); // Update PLL specific lowest times
    // saveStateToLocalStorage(); // switchSession already saves
}

function deleteCurrentTimes() {
    if (sessions[currentSession]) {
        // Reset session data completely
        sessions[currentSession] = { times: [], lowestTimesIndices: [] };
        renderTimesList();
        updateStatistics(); // Update stats after deleting times
        updatePllAlgorithmLowestTimes(); // Update PLL specific lowest times
        updateCharts(); // Update charts
        saveStateToLocalStorage(); // Save state after deleting times
    }
}

function deleteCurrentSession() {
    if (Object.keys(sessions).length <= 1) {
        alert('Cannot delete the last session.');
        return;
    }
    const sessionToDelete = currentSession;
    delete sessions[sessionToDelete];
    // Switch to the first available session
    currentSession = Object.keys(sessions)[0];
    currentSessionNameDisplay.textContent = currentSession; // Update sidebar title
    renderSessionDropdown(); // Refresh dropdown after deleting
    renderTimesList();
    updateStatistics(); // Update stats after deleting session
    updatePllAlgorithmLowestTimes(); // Update PLL specific lowest times
    updateCharts(); // Update charts
    saveStateToLocalStorage(); // Save state after deleting session
}

function renameCurrentSession() {
    if (!currentSession || !sessions[currentSession]) {
        alert('No session selected or session data is missing.');
        return;
    }

    const oldSessionName = currentSession;
    const newSessionName = prompt(`Enter new name for session "${oldSessionName}":`, oldSessionName);

    if (newSessionName === null || newSessionName.trim() === "") {
        console.log('User cancelled rename or provided an empty name.');
        return;
    }

    if (newSessionName.trim() === oldSessionName) {
        alert('New name is the same as the old name. No changes made.');
        return;
    }

    if (sessions[newSessionName.trim()]) {
        alert(`A session named "${newSessionName.trim()}" already exists. Please choose a different name.`);
        return;
    }

    // Proceed with renaming
    const sessionData = sessions[oldSessionName];
    delete sessions[oldSessionName];
    sessions[newSessionName.trim()] = sessionData;
    currentSession = newSessionName.trim();

    // Update UI
    currentSessionNameDisplay.textContent = currentSession;
    renderSessionDropdown(); // Re-renders dropdown with new name and selects it
    // No need to re-render times list or stats as they depend on currentSession which is now updated
    updatePllAlgorithmLowestTimes(); // If session names are used for PLL algs, update them
    saveStateToLocalStorage(); // Save the changes

    alert(`Session "${oldSessionName}" renamed to "${currentSession}".`);
}

function updatePllAlgorithmLowestTimes() {
    const algorithmItems = document.querySelectorAll('#algorithms-section .algorithm-item');
    algorithmItems.forEach(item => {
        const algName = item.getAttribute('data-alg-name');
        const displayElement = item.querySelector(`.alg-lowest-time-display[data-alg-name-ref="${algName}"]`);

        if (displayElement) {
            if (sessions[algName] && sessions[algName].times.length > 0) {
                const lowestTime = Math.min(...sessions[algName].times);
                displayElement.textContent = formatTime(lowestTime);
            } else {
                displayElement.textContent = 'N/A';
            }
        }
    });
}

function setupAlgorithmLinks() {
    // Select the divs that now wrap the images
    const algorithmItems = document.querySelectorAll('#algorithms-section .algorithm-item');
    algorithmItems.forEach(item => {
        item.addEventListener('click', (event) => {
            event.preventDefault(); // Prevent default link behavior
            const algName = item.getAttribute('data-alg-name');
            if (algName) {
                addSession(algName);
            }
        });
    });
}

// Tab switching functionality
function setupTabs() {
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            // Add active class to clicked button and corresponding content
            button.classList.add('active');
            const tabId = button.getAttribute('data-tab');
            document.getElementById(`${tabId}-tab`).classList.add('active');
        });
    });
}

// --- New Inspection Timer Logic ---
function startInspection() {
    if (inspectionEnabled && !isRunning && !inspectionRunning) {
        inspectionRunning = true;
        inspectionTimeLeft = 15;
        timerDisplay.textContent = inspectionTimeLeft; // Use main timer display
        timerDisplay.style.color = '#007bff'; // Blue during inspection
        timerDisplay.classList.add('inspection'); // Add class for potential styling
        instructions.textContent = 'Inspecting... Press SPACEBAR again to start timer.'; // Updated instruction
        clearTimeout(inspectionTimeout); // Clear any pending reset timeout

        inspectionInterval = setInterval(() => {
            inspectionTimeLeft--;
            timerDisplay.textContent = inspectionTimeLeft;

            if (inspectionTimeLeft <= 0) {
                clearInterval(inspectionInterval);
                inspectionInterval = null;
                timerDisplay.textContent = "Inspection Over";
                instructions.textContent = 'Inspection Over. Press SPACEBAR to start timer.'; // Updated instruction
                // Don't automatically reset here, wait for the next spacebar press
                // inspectionTimeout = setTimeout(resetInspection, 2000); // Remove automatic reset timeout
            }
        }, 1000);
    }
}

function resetInspection() {
    if (inspectionRunning || inspectionInterval) { // Check if inspection was active or interval exists
        clearInterval(inspectionInterval);
        clearTimeout(inspectionTimeout); // Clear reset timeout
        inspectionInterval = null;
        inspectionTimeout = null;
        inspectionRunning = false;
        timerDisplay.style.color = '#333'; // Reset color
        timerDisplay.classList.remove('inspection');
        // Only reset display if timer is not running
        if (!isRunning) {
            timerDisplay.textContent = '0:00.000';
            // Update default instructions based on inspection setting
            if (inspectionEnabled) {
                instructions.textContent = 'Press and hold SPACEBAR for 0.2s to start inspection.';
            } else {
                instructions.textContent = 'Press and hold SPACEBAR for 0.2s to start timer.';
            }
        }
    }
}
// --- End New Inspection Timer Logic ---

// Function to check if spacebar has been held long enough
function checkHoldTime() {
    if (spacebarHeld && !holdTimeReached) {
        const currentHoldTime = Date.now() - spacebarPressTime;

        if (currentHoldTime >= minHoldTime) {
            // Minimum hold time reached, change color to green
            timerDisplay.style.color = '#008000'; // Green when ready
            holdTimeReached = true;

            // Update instructions to indicate ready state
            if (inspectionEnabled && !inspectionRunning) {
                instructions.textContent = 'Ready! Release SPACEBAR to start inspection.';
            } else if (!inspectionEnabled || inspectionRunning) {
                instructions.textContent = 'Ready! Release SPACEBAR to start timer.';
            }
        }
    }
}

document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
        // Prevent default spacebar behavior (scrolling)
        event.preventDefault();

        if (isRunning) {
            // Stop timer on keydown if it's running
            stopTimer();
            spacebarHeld = false; // Prevent keyup from restarting immediately
            holdTimeReached = false; // Reset hold time flag
            clearInterval(holdCheckInterval); // Clear any existing hold check interval
        } else if (!spacebarHeld && !inspectionRunning) {
            // Only register keydown if timer isn't running, inspection isn't running, and key isn't already held
            spacebarHeld = true;
            holdTimeReached = false; // Reset hold time flag
            spacebarPressTime = Date.now(); // Record when spacebar was pressed

            // Indicate readiness on keydown, but don't start anything yet
            timerDisplay.style.color = '#ffa500'; // Orange when key is initially held
            if (inspectionEnabled) {
                instructions.textContent = 'Hold SPACEBAR for 0.2s, then release to start inspection.';
            } else {
                instructions.textContent = 'Hold SPACEBAR for 0.2s, then release to start timer.';
            }

            // Start checking if spacebar has been held long enough
            clearInterval(holdCheckInterval); // Clear any existing interval
            holdCheckInterval = setInterval(checkHoldTime, 10); // Check every 10ms
        } else if (!spacebarHeld && inspectionRunning) {
            // If inspection is running, register keydown to prepare for stopping inspection on keyup
            spacebarHeld = true;
            holdTimeReached = false; // Reset hold time flag
            spacebarPressTime = Date.now(); // Record when spacebar was pressed
            timerDisplay.style.color = '#ffa500'; // Orange when key is initially held
            instructions.textContent = 'Hold SPACEBAR for 0.2s, then release to start timer.';

            // Start checking if spacebar has been held long enough
            clearInterval(holdCheckInterval); // Clear any existing interval
            holdCheckInterval = setInterval(checkHoldTime, 10); // Check every 10ms
        }
        // Do nothing if spacebarHeld is already true (prevents re-triggering on hold)

    } else if (isRunning) { // Stop with any other key as well (keep this?)
        stopTimer();
    }
});

document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
        if (spacebarHeld) { // Only act if keydown was registered
            // Clear the hold check interval
            clearInterval(holdCheckInterval);
            holdCheckInterval = null;

            const holdDuration = Date.now() - spacebarPressTime;
            spacebarHeld = false; // Reset flag

            // Only proceed if spacebar was held for at least the minimum time
            if (holdDuration >= minHoldTime) {
                // Reset the hold time flag
                holdTimeReached = false;

                if (inspectionEnabled) {
                    if (!inspectionRunning) {
                        // --- Start Inspection ---
                        timerDisplay.textContent = '0:00.000'; // Reset timer display before inspection
                        startInspection();
                    } else {
                        // --- Stop Inspection, Start Timer ---
                        resetInspection();
                        startTimer();
                    }
                } else {
                    // --- Inspection Disabled: Start Timer ---
                    if (!isRunning) { // Only start if not already running
                        timerDisplay.textContent = '0:00.000'; // Reset timer display
                        startTimer();
                    }
                }
            } else {
                // If spacebar wasn't held long enough, reset the display and instructions
                timerDisplay.style.color = '#333'; // Reset color
                holdTimeReached = false; // Reset the hold time flag

                if (inspectionEnabled) {
                    instructions.textContent = 'Press and hold SPACEBAR for 0.2s to start inspection.';
                } else {
                    instructions.textContent = 'Press and hold SPACEBAR for 0.2s to start timer.';
                }
            }
        }
    }
});

// Event Listeners for buttons (Keep only one block)
settingsButton.addEventListener('click', () => { // New listener for settings
    settingsPanel.style.display = 'block';
});

const showChartsCheckbox = document.getElementById('toggle-charts');
const chartsArea = document.getElementById('charts-area')

showChartsCheckbox.addEventListener('change', () => {
    chartsArea.style.display = showChartsCheckbox.checked ? 'block' : 'none';
});

addSessionBtn.addEventListener('click', () => addSession()); // Call without specific name
deleteTimesBtn.addEventListener('click', deleteCurrentTimes);
deleteSessionBtn.addEventListener('click', deleteCurrentSession);
renameSessionBtn.addEventListener('click', renameCurrentSession); // New listener
exportSessionBtn.addEventListener('click', handleAuthClick); // Trigger auth/export

// --- Google Sheets API Functions ---

/**
 * Callback after api.js is loaded.
 */
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

/**
 * Callback after the API client is loaded. Loads the
 * discovery doc to initialize the API.
 */
async function initializeGapiClient() {
    await gapi.client.init({
        // NOTE: API Key is not used for OAuth2 flows
        // apiKey: API_KEY,
        discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
    });
    gapiInited = true;
    maybeEnableExportButton();
}

/**
 * Callback after Google Identity Services are loaded.
 */
function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: '', // Defined later
    });
    gisInited = true;
    maybeEnableExportButton();
}

/**
 * Enables user interaction after all libraries are loaded.
 */
function maybeEnableExportButton() {
    if (gapiInited && gisInited) {
        exportSessionBtn.disabled = false; // Enable the button once APIs are ready
        console.log("Google API and GIS initialized.");
    }
}

/**
 *  Sign in the user upon button click.
 */
function handleAuthClick() {
    if (!tokenClient) {
        alert("Google API not fully loaded yet. Please wait a moment.");
        return;
    }
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        // GIS has automatically updated gapi.client with the newly issued access token.
        console.log('gapi.client access token: ' + JSON.stringify(gapi.client.getToken()));
        await exportAllBestTimesToSheet(); // Updated function call
    };

    // Conditionally ask for authorization if access token doesn't exist.
    if (gapi.client.getToken() === null) {
        // Prompt the user to select a Google Account and ask for consent to share their data
        // when establishing a new session.
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        // Skip display of account chooser and consent dialog for an existing session.
        tokenClient.requestAccessToken({ prompt: '' });
    }
}


/**
 *  Sign out the user upon button click.
 */
// Optional: Add a sign-out button and uncomment this if needed
// function handleSignoutClick() {
//   const token = gapi.client.getToken();
//   if (token !== null) {
//     google.accounts.oauth2.revoke(token.access_token);
//     gapi.client.setToken('');
//     // Update UI (e.g., disable export button)
//     console.log("User signed out.");
//     exportSessionBtn.textContent = 'Authorize & Export';
//   }
// }

/**
 * Export all best times from all sessions to the configured Google Sheet.
 * It will update existing entries if a better time is found or append new ones.
 */
async function exportAllBestTimesToSheet() {
    const PLL_BEST_TIMES_SHEET_NAME = 'PLLTimerBestTimes';
    const SHEET_HEADER = ['Session Name', 'Best Time (ms)', 'Best Time (Formatted)', 'Last Updated (WebApp)'];
    const SHEET_DATA_RANGE_READ = `${PLL_BEST_TIMES_SHEET_NAME}!A:D`; // Read all potential columns
    let sheetConfirmedNonExistent = false; // Flag to track if sheet needs creation

    // 1. Collect all best times from the web app
    const allAppBestTimes = [];
    for (const sessionName in sessions) {
        if (sessions.hasOwnProperty(sessionName) && sessions[sessionName].times.length > 0) {
            const bestTimeMs = Math.min(...sessions[sessionName].times);
            allAppBestTimes.push({
                name: sessionName,
                timeMs: bestTimeMs,
                timeFormatted: formatTime(bestTimeMs)
            });
        }
    }

    if (allAppBestTimes.length === 0) {
        alert('No times recorded in any session to export.');
        return;
    }

    // 2. Read existing data from the sheet
    let existingSheetRows = [];
    let sheetExistsAndHasData = false;
    try {
        const sheetValuesResponse = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: SHEET_DATA_RANGE_READ,
        });
        if (sheetValuesResponse.result.values && sheetValuesResponse.result.values.length > 0) {
            existingSheetRows = sheetValuesResponse.result.values;
            sheetExistsAndHasData = true;
        }
        console.log("Sheet data read successfully:", existingSheetRows);
    } catch (err) {
        if (err.result && err.result.error &&
            ((err.result.error.code === 400 && err.result.error.message.includes("Unable to parse range")) ||
                (err.result.error.status === 'NOT_FOUND'))
        ) {
            console.log(`Sheet '${PLL_BEST_TIMES_SHEET_NAME}' not found during initial read. Will attempt to create if data is exported.`);
            sheetConfirmedNonExistent = true; // Mark that the sheet definitely doesn't exist
            // sheetExistsAndHasData remains false, existingSheetRows remains empty
            // isFirstWrite will be true later, triggering header addition
        } else {
            console.error('Error reading from Google Sheet:', err);
            alert(`Error reading data from sheet: ${err.result?.error?.message || err.message}`);
            return;
        }
    }

    const sheetDataMap = new Map(); // Maps sessionName to { rowIndexInSheet, timeMs }
    let proceedWithExport = true;
    let isFirstWrite = !sheetExistsAndHasData; // True if sheet was empty or didn't exist

    if (sheetExistsAndHasData) {
        if (existingSheetRows[0] &&
            existingSheetRows[0].length === SHEET_HEADER.length &&
            existingSheetRows[0].every((val, idx) => val === SHEET_HEADER[idx])) {
            // Header matches, populate map from row 2 onwards
            existingSheetRows.slice(1).forEach((row, index) => {
                if (row[0] && row[1] !== undefined && row[1] !== null) { // Session Name in col A, Time (ms) in col B
                    sheetDataMap.set(row[0], {
                        rowIndexInSheet: index + 2, // Sheet row index (1-based)
                        timeMs: parseInt(row[1], 10),
                    });
                }
            });
            isFirstWrite = false; // Sheet exists and has a compatible header
        } else {
            // Sheet has data, but header doesn't match.
            alert(`Sheet '${PLL_BEST_TIMES_SHEET_NAME}' exists but has an incompatible header. Expected: ${JSON.stringify(SHEET_HEADER)}. Found: ${JSON.stringify(existingSheetRows[0])}. Please clear the sheet or ensure the header matches.`);
            proceedWithExport = false;
        }
    }
    // If !sheetExistsAndHasData, isFirstWrite is true, sheetDataMap is empty.

    if (!proceedWithExport) {
        return;
    }

    // 3. Prepare data for updates and appends
    const batchUpdateData = []; // For gapi.client.sheets.spreadsheets.values.batchUpdate
    const newRowsData = [];     // Raw data for new rows (to be potentially prepended with header)

    const exportTimestamp = new Date().toLocaleString();

    allAppBestTimes.forEach(appTime => {
        const sheetEntry = sheetDataMap.get(appTime.name);
        if (sheetEntry) { // Session exists in sheet
            if (appTime.timeMs < sheetEntry.timeMs) {
                batchUpdateData.push({
                    range: `${PLL_BEST_TIMES_SHEET_NAME}!A${sheetEntry.rowIndexInSheet}:D${sheetEntry.rowIndexInSheet}`,
                    values: [[appTime.name, appTime.timeMs, appTime.timeFormatted, exportTimestamp]]
                });
            }
        } else { // Session is new (or sheet was empty/headerless, so all are new)
            newRowsData.push([appTime.name, appTime.timeMs, appTime.timeFormatted, exportTimestamp]);
        }
    });

    let updatesMadeCount = 0;
    let appendsMadeCount = 0; // Count of actual data rows appended

    // 4. Perform updates
    if (batchUpdateData.length > 0) {
        try {
            await gapi.client.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    valueInputOption: 'USER_ENTERED',
                    data: batchUpdateData
                }
            });
            updatesMadeCount = batchUpdateData.length;
            console.log(`${updatesMadeCount} row(s) updated in Google Sheet.`);
        } catch (err) {
            console.error('Error batch updating Google Sheet:', err);
            alert(`Error updating sheet data: ${err.result?.error?.message || err.message}`);
            // Decide if to proceed with appends or not. For now, we'll try.
        }
    }

    // 5. Perform appends (with header if it's the first write to this sheet structure)
    const rowsToActuallyAppend = [];
    if (isFirstWrite && newRowsData.length > 0) {
        rowsToActuallyAppend.push(SHEET_HEADER);
    }
    rowsToActuallyAppend.push(...newRowsData);

    if (rowsToActuallyAppend.length > 0) {
        try {
            // If the sheet was confirmed not to exist from the initial read, create it first.
            if (sheetConfirmedNonExistent) {
                try {
                    await gapi.client.sheets.spreadsheets.batchUpdate({
                        spreadsheetId: SPREADSHEET_ID,
                        resource: {
                            requests: [{ addSheet: { properties: { title: PLL_BEST_TIMES_SHEET_NAME } } }]
                        }
                    });
                    console.log(`Sheet '${PLL_BEST_TIMES_SHEET_NAME}' created successfully.`);
                } catch (createErr) {
                    // If creation fails, check if it's because it already exists (e.g., race condition or other)
                    if (createErr.result && createErr.result.error && createErr.result.error.message.includes("already exists")) {
                        console.warn(`Attempted to create sheet '${PLL_BEST_TIMES_SHEET_NAME}', but it already existed. Proceeding with append.`);
                    } else {
                        console.error(`Error creating Google Sheet '${PLL_BEST_TIMES_SHEET_NAME}':`, createErr);
                        alert(`Error creating sheet '${PLL_BEST_TIMES_SHEET_NAME}': ${createErr.result?.error?.message || createErr.message}`);
                        return; // Stop if sheet creation fails critically
                    }
                }
            }

            const appendResponse = await gapi.client.sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: PLL_BEST_TIMES_SHEET_NAME, // Appends after the last row with data in this sheet
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: rowsToActuallyAppend }
            });
            console.log('Append response:', appendResponse);
            appendsMadeCount = newRowsData.length; // Only count data rows, not header
            console.log(`${rowsToActuallyAppend.length} total row(s) prepared for append (includes header: ${isFirstWrite && newRowsData.length > 0}). ${appendsMadeCount} data rows appended.`);
        } catch (err) {
            console.error('Error appending to Google Sheet:', err);
            alert(`Error appending new data to sheet: ${err.result?.error?.message || err.message}`);
        }
    }

    // 6. Final feedback
    if (updatesMadeCount > 0 || appendsMadeCount > 0) {
        alert(`Export complete. Updated: ${updatesMadeCount} session(s). Appended: ${appendsMadeCount} new session(s).`);
    } else {
        alert('No data needed to be updated or appended to Google Sheet. All best times are current.');
    }
}

// --- End Google Sheets API Functions ---

// --- Chart Functions ---
function updateCharts() {
    if (!currentSession || !sessions[currentSession] || !rollingAveragesChartCtx || !sessionTimesChartCtx) {
        // Clear charts if no session or no data or canvas elements are not found
        if (rollingAveragesChart) {
            rollingAveragesChart.destroy();
            rollingAveragesChart = null;
        }
        if (sessionTimesChart) {
            sessionTimesChart.destroy();
            sessionTimesChart = null;
        }
        return;
    }

    const sessionData = sessions[currentSession];
    const times = sessionData.times;
    const lowestIndices = sessionData.lowestTimesIndices;

    // Rolling Averages Chart
    const ao5Data = [];
    const ao12Data = [];
    const labels = [];

    for (let i = 0; i < times.length; i++) {
        labels.push(i + 1);
        const timesUpToCurrent = times.slice(0, i + 1);
        if (i >= 4) { // ao5 needs at least 5 solves
            const ao5 = calculateBoN(timesUpToCurrent, 5);
            ao5Data.push(ao5 !== null ? ao5 / 1000 : null); // Convert to seconds
        } else {
            ao5Data.push(null); // Not enough data
        }
        if (i >= 11) { // ao12 needs at least 12 solves
            const ao12 = calculateBoN(timesUpToCurrent, 12);
            ao12Data.push(ao12 !== null ? ao12 / 1000 : null); // Convert to seconds
        } else {
            ao12Data.push(null); // Not enough data
        }
    }

    if (rollingAveragesChart) {
        rollingAveragesChart.data.labels = labels;
        rollingAveragesChart.data.datasets[0].data = ao5Data;
        rollingAveragesChart.data.datasets[1].data = ao12Data;
        rollingAveragesChart.update();
    } else {
        rollingAveragesChart = new Chart(rollingAveragesChartCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'ao5',
                    data: ao5Data,
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1,
                    fill: false,
                    spanGaps: true, // Connect lines over null data points
                }, {
                    label: 'ao12',
                    data: ao12Data,
                    borderColor: 'rgb(255, 99, 132)',
                    tension: 0.1,
                    fill: false,
                    spanGaps: true, // Connect lines over null data points
                }]
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: false,
                        title: {
                            display: true,
                            text: 'Time (seconds)'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Solve Number'
                        }
                    }
                },
                responsive: true,
                maintainAspectRatio: true,
                layout: {
                    padding: {
                        top: 10,
                        right: 10,
                        bottom: 10,
                        left: 10
                    }
                },
                height: 300 // Set a fixed height
            }
        });
    }

    // Session Times Distribution Chart (Scatter Plot)
    const scatterData = times.map((time, index) => ({
        x: index + 1, // Solve number
        y: time / 1000 // Time in seconds
    }));

    // Create a separate dataset for lowest times
    const lowestTimesData = lowestIndices.map(index => ({
        x: index + 1, // Solve number
        y: times[index] / 1000 // Time in seconds
    })).sort((a, b) => a.x - b.x); // Sort by solve number

    const pointBackgroundColors = times.map((time, index) => {
        return lowestIndices.includes(index) ? 'gold' : 'rgba(54, 162, 235, 0.6)';
    });
    const pointBorderColors = times.map((time, index) => {
        return lowestIndices.includes(index) ? 'orange' : 'rgba(54, 162, 235, 1)';
    });

    if (sessionTimesChart) {
        sessionTimesChart.data.datasets[0].data = scatterData;
        sessionTimesChart.data.datasets[0].backgroundColor = pointBackgroundColors;
        sessionTimesChart.data.datasets[0].borderColor = pointBorderColors;

        // Update or create the lowest times dataset
        if (sessionTimesChart.data.datasets.length > 1) {
            sessionTimesChart.data.datasets[1].data = lowestTimesData;
        } else {
            sessionTimesChart.data.datasets.push({
                label: 'Best Times',
                data: lowestTimesData,
                backgroundColor: 'gold',
                borderColor: 'orange',
                borderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                showLine: true,
                fill: false,
                tension: 0.1
            });
        }
        sessionTimesChart.update();
    } else {
        sessionTimesChart = new Chart(sessionTimesChartCtx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Solve Times',
                        data: scatterData,
                        backgroundColor: pointBackgroundColors,
                        borderColor: pointBorderColors,
                        borderWidth: 1,
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        showLine: false
                    },
                    {
                        label: 'Best Times',
                        data: lowestTimesData,
                        backgroundColor: 'gold',
                        borderColor: 'orange',
                        borderWidth: 2,
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        showLine: true,
                        fill: false,
                        tension: 0.1
                    }
                ]
            },
            options: {
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        title: {
                            display: true,
                            text: 'Solve Number'
                        }
                    },
                    y: {
                        beginAtZero: false,
                        title: {
                            display: true,
                            text: 'Time (seconds)'
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y.toFixed(3) + 's';
                                }
                                return label;
                            }
                        }
                    }
                },
                responsive: true,
                maintainAspectRatio: true,
                layout: {
                    padding: {
                        top: 10,
                        right: 10,
                        bottom: 10,
                        left: 10
                    }
                },
                height: 300 // Set a fixed height
            }
        });
    }
}
// --- End Chart Functions ---

// Initial setup
function initialize() {
    loadStateFromLocalStorage(); // Load saved state first

    // Check if chart canvas elements exist before trying to use them
    if (rollingAveragesChartCtx && sessionTimesChartCtx) {
        updateCharts(); // Initial chart render if canvas elements are present
    }


    exportSessionBtn.disabled = true; // Disable export button until APIs load
    timerDisplay.style.color = '#333'; // Default color
    setupAlgorithmLinks(); // Add listeners for algorithm links
    setupTabs(); // Set up tab navigation


    // If no sessions were loaded from localStorage, initialize default PLL sessions
    if (Object.keys(sessions).length === 0) {
        currentSessionNameDisplay.textContent = 'Select a PLL'; // Set initial sidebar title
        const algorithmItems = document.querySelectorAll('#algorithms-section .algorithm-item');
        let firstAlgName = null;
        algorithmItems.forEach(item => {
            const algName = item.getAttribute('data-alg-name');
            if (algName) {
                if (!firstAlgName) firstAlgName = algName; // Capture the first one
                sessions[algName] = { times: [], lowestTimesIndices: [] };
            }
        });
        currentSession = firstAlgName; // Set the first PLL alg as current
        sessionCounter = Object.keys(sessions).length > 0 ? Object.keys(sessions).length : 1; // Initialize counter based on PLLs
        saveStateToLocalStorage(); // Save initial default state
    } else {
        // If sessions were loaded, ensure currentSessionNameDisplay is updated
        if (currentSession && sessions[currentSession]) {
            currentSessionNameDisplay.textContent = currentSession;
        } else if (Object.keys(sessions).length > 0) {
            // Fallback if currentSession is invalid but sessions exist
            currentSession = Object.keys(sessions)[0];
            currentSessionNameDisplay.textContent = currentSession;
            saveStateToLocalStorage(); // Save corrected currentSession
        } else {
            // This case implies no sessions exist at all.
            // We might want to create a default "Session 1" here if PLLs aren't the primary focus.
            // For now, let's assume PLLs are primary if no other sessions.
            // If even PLLs aren't defined (e.g. HTML structure changes), this could be an issue.
            addSession(); // Creates "Session 1" if truly nothing exists.
        }
    }

    renderSessionDropdown(); // Initial dropdown population
    renderTimesList();
    updateStatistics(); // Initial statistics calculation
    // updateCharts(); // Moved up to ensure canvas elements are checked first

    // Update initial instructions based on default inspection state
    if (enableInspectionCheckbox.checked) {
        instructions.textContent = 'Press and hold SPACEBAR for 0.2s to start inspection.';
    } else {
        instructions.textContent = 'Press and hold SPACEBAR for 0.2s to start timer.';
    }

    // Set up inspection checkbox
    enableInspectionCheckbox.checked = false; // Default to disabled
    inspectionEnabled = false;
    enableInspectionCheckbox.addEventListener('change', function () {
        inspectionEnabled = this.checked;
        // If inspection is running and user disables it, reset immediately
        if (!inspectionEnabled && inspectionRunning) {
            resetInspection();
        }
        // Update instructions when checkbox is toggled and timer isn't running
        if (!isRunning && !inspectionRunning) {
            if (inspectionEnabled) {
                instructions.textContent = 'Press and hold SPACEBAR for 0.2s to start inspection.';
            } else {
                instructions.textContent = 'Press and hold SPACEBAR for 0.2s to start timer.';
            }
        }
    });

    // Ensure current session name is displayed correctly if loaded
    if (currentSession) {
        currentSessionNameDisplay.textContent = currentSession;
    } else if (Object.keys(sessions).length > 0) {
        // This case should ideally be handled by loadStateFromLocalStorage or default init
        currentSessionNameDisplay.textContent = Object.keys(sessions)[0];
    } else {
        currentSessionNameDisplay.textContent = 'No Sessions Yet'; // Fallback if addSession didn't run
    }

    // Event Listeners that should be set up after initial state is determined
    addSessionBtn.addEventListener('click', () => addSession()); // No specific name, will generate "Session X"
    deleteTimesBtn.addEventListener('click', deleteCurrentTimes);
    deleteSessionBtn.addEventListener('click', deleteCurrentSession);
    renameSessionBtn.addEventListener('click', renameCurrentSession);

    settingsButton.addEventListener('click', () => {
        settingsPanel.classList.toggle('hidden');
    });

    exportSessionBtn.addEventListener('click', () => {
        if (gapiInited && gisInited && tokenClient.hasGrantedScopes(SCOPES)) {
            exportAllBestTimesToSheet();
        } else {
            handleAuthClick();
        }
    });
    // Call updateCharts again here to ensure it runs after all session logic is complete
    // and DOM elements for charts are definitely available.
    if (rollingAveragesChartCtx && sessionTimesChartCtx) {
        updateCharts();
    }

    // Add event listeners for spacebar and other keys for timer control
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    // Add other global event listeners if needed, e.g., for window resize if charts need to adapt beyond 'responsive: true'
}

// Separate event handler functions for clarity, if they become complex
function handleKeyDown(event) {
    if (event.code === 'Space') {
        event.preventDefault();
        if (isRunning) {
            stopTimer();
        } else if (!spacebarHeld) {
            spacebarPressTime = Date.now();
            spacebarHeld = true;
            holdTimeReached = false; // Reset flag
            timerDisplay.style.color = '#d32f2f'; // Red to indicate "holding"

            // Start checking if hold time is met
            if (holdCheckInterval) clearInterval(holdCheckInterval); // Clear existing interval
            holdCheckInterval = setInterval(checkHoldTime, 50); // Check every 50ms

            if (inspectionEnabled && !inspectionRunning) {
                instructions.textContent = 'Hold...';
            } else {
                instructions.textContent = 'Hold...';
            }
        }
    } else if (isRunning) { // Any key stops the timer if it's running
        stopTimer();
    }
}

function handleKeyUp(event) {
    if (event.code === 'Space') {
        event.preventDefault();
        clearInterval(holdCheckInterval); // Stop checking hold time

        if (spacebarHeld && holdTimeReached) {
            if (inspectionEnabled && !inspectionRunning) {
                startInspection();
            } else {
                // If inspection was running and space is released, or inspection is disabled
                if (inspectionRunning) {
                    clearInterval(inspectionInterval); // Stop inspection countdown
                    inspectionInterval = null;
                    inspectionRunning = false; // Mark inspection as no longer running
                }
                startTimer();
            }
        } else if (spacebarHeld && !holdTimeReached) {
            // If spacebar was released too early
            timerDisplay.style.color = '#333'; // Reset to default color
            if (inspectionEnabled && !inspectionRunning) {
                instructions.textContent = 'Press and hold SPACEBAR for 0.2s to start inspection.';
            } else {
                instructions.textContent = 'Press and hold SPACEBAR for 0.2s to start timer.';
            }
        }
        spacebarHeld = false;
        holdTimeReached = false; // Reset for next press
    }
}

// Make sure initialize is called after the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initialize);

// Add this with the other event listeners
document.getElementById('open-spreadsheet').addEventListener('click', () => {
    window.open(SPREADSHEET_LINK, '_blank');
});
