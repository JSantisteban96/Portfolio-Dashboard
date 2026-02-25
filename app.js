let equityChart = null;
let isPercentageMode = false;
let globalEquityDataUSD = [];
let globalEquityDataPct = [];
let globalChartLabels = [];
let monthlyDataStructure = {};

// Default initial balance to calculate Return % and Drawdown %. 
// Adjust this to match your actual starting account balance if you wish.
const INITIAL_BALANCE = 10000;

document.getElementById('csvFileInput').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('uploadStatus');
    statusEl.textContent = `Processing ${file.name}...`;

    // Parse CSV using PapaParse
    Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function (results) {
            processData(results.data);
            statusEl.textContent = `Loaded ${results.data.length} records.`;
        },
        error: function (error) {
            statusEl.textContent = `Error parsing CSV!`;
            console.error(error);
        }
    });
});

function processData(trades) {
    // Validate CSV Structure (Check for typical MT5 Columns)
    if (!trades.length || trades[0]['Profit'] === undefined || trades[0]['Close Date'] === undefined) {
        alert("Invalid CSV format. Please ensure it's a standard MT5 history export containing 'Profit' and 'Close Date'.");
        return;
    }

    // Sort trades chronologically by Close Date
    trades.sort((a, b) => new Date(a['Close Date']) - new Date(b['Close Date']));

    let grossProfit = 0;
    let grossLoss = 0;
    let winningTrades = 0;
    let totalTrades = 0;

    // Financial Tracking
    let currentEquity = 0;
    let netDeposits = 0;
    let peakEquity = 0;
    let maxDrawdownPct = 0;

    // Chart Data
    const chartLabels = [];
    const equityDataUSD = [];
    const equityDataPct = [];

    // Matrix Data

    // Filter to known action types to avoid junk
    trades.forEach(trade => {
        let action = trade['Action'] ? trade['Action'].toString() : '';
        let profit = trade['Profit'] || 0;
        let commission = trade['Commission'] || 0;
        let swap = trade['Swap'] || 0;

        // --- scenario A: Deposit / Withdrawal ---
        // MT5 often labels these as "Deposit", "Balance", "Op Balance", etc.
        // We catch typical keywords.
        if (action.match(/Deposit|Balance/i)) {
            // Usually only 'Profit' field holds the amount for deposits
            currentEquity += profit;
            netDeposits += profit;

            // Re-evaluate peak equity after a funding event so we don't calculate fake drawdown
            if (currentEquity > peakEquity) {
                peakEquity = currentEquity;
            }

            // Add a chart point for the deposit
            let dt = new Date(trade['Close Date']);
            let dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });

            chartLabels.push(dateStr + " (Dep)");
            equityDataUSD.push(currentEquity);

            let currentPct = netDeposits > 0 ? ((currentEquity - netDeposits) / netDeposits) * 100 : 0;
            equityDataPct.push(currentPct);

            return; // Done with this row
        }

        // --- scenario B: Trading Activity (Buy/Sell) ---
        if (action === 'Buy' || action === 'Sell') {
            totalTrades++;

            let dt = new Date(trade['Close Date']);
            let year = dt.getFullYear();
            let month = dt.getMonth() + 1; // 1-12

            if (!monthlyDataStructure[year]) monthlyDataStructure[year] = {};
            if (!monthlyDataStructure[year][month]) {
                monthlyDataStructure[year][month] = {
                    profitUSD: 0,
                    startEquity: currentEquity // Equity before this trade
                };
            }

            // Net result of the trade
            let netPnl = profit;

            if (netPnl > 0) {
                grossProfit += netPnl;
                winningTrades++;
            } else {
                grossLoss += Math.abs(netPnl);
            }

            currentEquity += netPnl;
            monthlyDataStructure[year][month].profitUSD += netPnl;

            // Track Peak Equity for Drawdown Calculation
            if (currentEquity > peakEquity) {
                peakEquity = currentEquity;
            } else {
                // Calculate drawdown from the highest point seen so far
                if (peakEquity > 0) {
                    let currentDrawdownPct = ((peakEquity - currentEquity) / peakEquity) * 100;
                    if (currentDrawdownPct > maxDrawdownPct) {
                        maxDrawdownPct = currentDrawdownPct;
                    }
                }
            }

            // Chart point
            let dateStr = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
            chartLabels.push(dateStr);
            equityDataUSD.push(currentEquity);

            let currentPct = netDeposits > 0 ? ((currentEquity - netDeposits) / netDeposits) * 100 : 0;
            equityDataPct.push(currentPct);
        }
    });


    // --- Metric Calculations ---
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 99.99 : 0);

    // Return % = (Total Profit / Total Invested Capital)
    // Avoid division by zero if no deposits found
    const totalReturnPct = netDeposits > 0 ? ((currentEquity - netDeposits) / netDeposits) * 100 : 0;

    // --- Update Dynamic UI Elements ---
    updateMetric('valReturn', totalReturnPct, true, '%');
    updateMetric('valWinRate', winRate, false, '%');

    // Profit Factor does not get +/-, just standard 2 decimal places
    document.getElementById('valProfitFactor').textContent = profitFactor.toFixed(2);

    // Drawdown is always represented as a negative value for investors
    updateMetric('valDrawdown', -Math.abs(maxDrawdownPct), true, '%');

    globalChartLabels = chartLabels;
    globalEquityDataUSD = equityDataUSD;
    globalEquityDataPct = equityDataPct;

    // Re-render the canvas equity curve and matrix
    renderChart(globalChartLabels, isPercentageMode ? globalEquityDataPct : globalEquityDataUSD);
    renderMatrix();
}

// Helper to format DOM text
function updateMetric(id, value, useColorClasses, suffix) {
    const el = document.getElementById(id);

    // Format string (add + sign if positive)
    let formattedString = (value > 0 && id !== 'valDrawdown' ? '+' : '') + value.toFixed(2) + suffix;
    el.textContent = formattedString;

    // Update color styling
    if (useColorClasses) {
        if (value >= 0 && id !== 'valDrawdown') {
            el.className = 'value positive';
        } else if (value < 0 || id === 'valDrawdown') {
            el.className = 'value negative';
        }
    }
}

// Chart.js Configuration for Premium aesthetic
function renderChart(labels, data) {
    const ctx = document.getElementById('equityChart').getContext('2d');

    // Destroy previous chart instance if it exists (e.g. when uploading a new CSV)
    if (equityChart) {
        equityChart.destroy();
    }

    // Global Font Settings
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Outfit';

    equityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: isPercentageMode ? 'Cumulative Return (%)' : 'Account Equity (USD)',
                data: data,
                borderColor: '#3b82f6', // Bright Blue line
                backgroundColor: 'rgba(59, 130, 246, 0.1)', // Blue Gradient Fill
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.15 // Slight curve
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // Hide legend for cleaner look
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(10, 11, 16, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#3b82f6',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: function (context) {
                            let val = context.parsed.y;
                            return isPercentageMode ? ' Return: ' + val.toFixed(2) + '%' : ' Equity: $' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false,
                        drawBorder: false
                    },
                    ticks: {
                        maxTicksLimit: 8, // Prevent label crowding 
                        maxRotation: 0
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        callback: function (value) {
                            return isPercentageMode ? value.toFixed(0) + '%' : '$' + value.toLocaleString();
                        }
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// Matrix Rendering Logic
function renderMatrix() {
    const table = document.getElementById('monthlyMatrix');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    // Clear existing
    thead.innerHTML = '';
    tbody.innerHTML = '';

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Build Header
    let trHead = document.createElement('tr');
    trHead.innerHTML = '<th>Year</th>';
    monthNames.forEach(m => {
        trHead.innerHTML += `<th>${m}</th>`;
    });
    trHead.innerHTML += '<th>Total</th>';
    thead.appendChild(trHead);

    const years = Object.keys(monthlyDataStructure).sort();

    if (years.length === 0) {
        tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;">No data available for matrix</td></tr>';
        return;
    }

    years.forEach((year) => {
        let tr = document.createElement('tr');
        tr.innerHTML = `<td>${year}</td>`;

        let yearlyTotalUSD = 0;
        let yearlyFirstValidEquity = -1;

        for (let m = 1; m <= 12; m++) {
            let td = document.createElement('td');

            if (monthlyDataStructure[year][m]) {
                const profitUSD = monthlyDataStructure[year][m].profitUSD;
                const startEquity = monthlyDataStructure[year][m].startEquity;

                if (yearlyFirstValidEquity === -1 && startEquity > 0) {
                    yearlyFirstValidEquity = startEquity; // First known equity of the year
                }

                let valToDisplay = 0;
                let formattedStr = '';

                if (isPercentageMode) {
                    valToDisplay = startEquity > 0 ? (profitUSD / startEquity) * 100 : 0;
                    formattedStr = (valToDisplay > 0 ? '+' : '') + valToDisplay.toFixed(2) + '%';
                } else {
                    valToDisplay = profitUSD;
                    formattedStr = (valToDisplay > 0 ? '+$' : (valToDisplay < 0 ? '-$' : '$')) + Math.abs(valToDisplay).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                }

                let valClass = valToDisplay > 0 ? 'val-pos' : (valToDisplay < 0 ? 'val-neg' : 'val-zero');
                if (profitUSD === 0) valClass = 'val-zero';
                td.innerHTML = `<span class="${valClass}">${formattedStr}</span>`;

                yearlyTotalUSD += profitUSD;
            } else {
                td.innerHTML = '-';
            }
            tr.appendChild(td);
        }

        // Year Total Column
        let tdTotal = document.createElement('td');
        let totalVal = 0;
        let totalFormatted = '';

        if (isPercentageMode) {
            totalVal = yearlyFirstValidEquity > 0 ? (yearlyTotalUSD / yearlyFirstValidEquity) * 100 : 0;
            totalFormatted = (totalVal > 0 ? '+' : '') + totalVal.toFixed(2) + '%';
        } else {
            totalVal = yearlyTotalUSD;
            totalFormatted = (totalVal > 0 ? '+$' : (totalVal < 0 ? '-$' : '$')) + Math.abs(totalVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        let totalClass = totalVal > 0 ? 'val-pos' : (totalVal < 0 ? 'val-neg' : 'val-zero');
        if (yearlyTotalUSD === 0) totalClass = 'val-zero';

        tdTotal.innerHTML = `<strong class="${totalClass}">${totalFormatted}</strong>`;
        tr.appendChild(tdTotal);

        tbody.appendChild(tr);
    });
}

// Setup Toggle Event Listener
document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('matrixToggle');
    if (toggle) {
        toggle.addEventListener('change', (e) => {
            isPercentageMode = e.target.checked;

            // Toggle label styling
            const labels = document.querySelectorAll('.toggle-label');
            if (labels.length >= 2) {
                if (isPercentageMode) {
                    labels[0].classList.remove('active');
                    labels[1].classList.add('active');
                } else {
                    labels[0].classList.add('active');
                    labels[1].classList.remove('active');
                }
            }

            // Re-render
            if (globalChartLabels.length > 0) {
                renderChart(globalChartLabels, isPercentageMode ? globalEquityDataPct : globalEquityDataUSD);
                renderMatrix();
            }
        });
    }
});
