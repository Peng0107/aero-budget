// State
let transactions = [];
let peer = null;
let conn = null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  renderDashboard();
  setupEventListeners();
  initPeer(); // Initialize WebRTC Sync
  
  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => {
      console.log('Service Worker Registered');
    });
  }
});

// --- Data Operations ---
function loadData() {
  const data = localStorage.getItem('budget_data');
  if (data) transactions = JSON.parse(data);
}

function saveData() {
  localStorage.setItem('budget_data', JSON.stringify(transactions));
  renderDashboard();
  // Auto-sync if connected
  if (conn && conn.open) {
    conn.send({ type: 'sync', data: transactions });
  }
}

function addTransaction(type, amount, desc) {
  const tx = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
    type,
    amount: parseFloat(amount),
    desc,
    date: new Date().toISOString()
  };
  transactions.push(tx);
  // Sort descending by date
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  saveData();
}

// Merge incoming data over network
function handleRemoteData(remoteData) {
  const existingIds = new Set(transactions.map(t => t.id));
  let changed = false;
  
  remoteData.forEach(rtx => {
    if (!existingIds.has(rtx.id)) {
      transactions.push(rtx);
      changed = true;
    }
  });

  if (changed) {
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    localStorage.setItem('budget_data', JSON.stringify(transactions));
    renderDashboard();
  }
}

// --- UI Rendering ---
function renderDashboard() {
  let totalIncome = 0;
  let totalExpense = 0;

  transactions.forEach(tx => {
    if (tx.type === 'income') totalIncome += tx.amount;
    else totalExpense += tx.amount;
  });

  const balance = totalIncome - totalExpense;

  document.getElementById('total-balance-display').innerText = formatMoney(balance);
  document.getElementById('total-income-display').innerText = formatMoney(totalIncome);
  document.getElementById('total-expense-display').innerText = formatMoney(totalExpense);

  const listEl = document.getElementById('transactions-list');
  listEl.innerHTML = '';

  if (transactions.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><i class="ri-wallet-3-line"></i><p>No transactions yet</p></div>`;
    return;
  }

  // Render top 10
  transactions.slice(0, 10).forEach(tx => {
    const isIncome = tx.type === 'income';
    const dateStr = new Date(tx.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    
    const div = document.createElement('div');
    div.className = 'tx-item';
    div.innerHTML = `
      <div class="tx-left">
        <div class="tx-icon ${tx.type}">
          <i class="${isIncome ? 'ri-arrow-up-line' : 'ri-arrow-down-line'}"></i>
        </div>
        <div class="tx-details">
          <p>${tx.desc}</p>
          <span>${dateStr}</span>
        </div>
      </div>
      <div class="tx-right ${tx.type}">
        ${isIncome ? '+' : '-'}${formatMoney(tx.amount)}
      </div>
    `;
    listEl.appendChild(div);
  });
}

function formatMoney(num) {
  return '$' + Math.abs(num).toFixed(2);
}

// --- Event Listeners ---
function setupEventListeners() {
  // Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const addIncomeBtn = document.getElementById('add-income-btn');
  const addExpenseBtn = document.getElementById('add-expense-btn');
  const modal = document.getElementById('transaction-modal');
  const form = document.getElementById('transaction-form');

  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      navItems.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('main-view').classList.add('hidden');
      document.getElementById('sync-view').classList.add('hidden');
      document.getElementById(btn.dataset.target).classList.remove('hidden');
    });
  });
  
  // Shortcut to switch to Sync view
  document.getElementById('nav-sync-btn').addEventListener('click', () => {
    navItems[1].click();
  });

  // Modal interactions
  const openModal = (type) => {
    document.getElementById('entry-type').value = type;
    document.getElementById('modal-title').innerText = type === 'income' ? 'Add Income' : 'Add Expense';
    modal.classList.remove('hidden');
    document.getElementById('entry-amount').focus();
  };

  addIncomeBtn.addEventListener('click', () => openModal('income'));
  addExpenseBtn.addEventListener('click', () => openModal('expense'));
  
  document.getElementById('close-modal-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
    form.reset();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = document.getElementById('entry-type').value;
    const amount = document.getElementById('entry-amount').value;
    const desc = document.getElementById('entry-desc').value;
    
    addTransaction(type, amount, desc);
    
    modal.classList.add('hidden');
    form.reset();
  });
  
  // Sync Controls
  document.getElementById('connect-btn').addEventListener('click', () => {
    const targetId = document.getElementById('target-peer-id').value.trim();
    if (targetId) connectToPeer(targetId);
  });

  document.getElementById('disconnect-btn').addEventListener('click', () => {
    if (conn) conn.close();
    setSyncStatus(false);
  });
}

// --- WebRTC PeerJS Sync Logic ---
function initPeer() {
  // Generate random simple 4-6 char id
  const randomId = Math.random().toString(36).substring(2, 6).toUpperCase();
  
  peer = new Peer('AERO-' + randomId, {
    debug: 2
  });

  peer.on('open', (id) => {
    document.getElementById('my-peer-id').innerText = id;
  });

  // Incoming connection
  peer.on('connection', (connection) => {
    setupConnection(connection);
  });
  
  peer.on('error', (err) => {
    console.warn("PeerJS Error:", err);
    alert("Connection Error: " + err.type);
  });
}

function connectToPeer(targetId) {
  // Prefix with AERO- if not present (to make typing easier for user)
  if(!targetId.startsWith('AERO-')) {
    targetId = 'AERO-' + targetId;
  }
  const connection = peer.connect(targetId);
  setupConnection(connection);
}

function setupConnection(connection) {
  conn = connection;
  
  conn.on('open', () => {
    console.log('Connected to:', conn.peer);
    setSyncStatus(true);
    
    // Instantly sync my local data to them upon connecting
    conn.send({ type: 'sync', data: transactions });
  });

  conn.on('data', (payload) => {
    if (payload.type === 'sync') {
      console.log('Received data payload of size:', payload.data.length);
      handleRemoteData(payload.data);
    }
  });

  conn.on('close', () => {
    console.log('Connection closed');
    setSyncStatus(false);
    conn = null;
  });
}

function setSyncStatus(isConnected) {
  const setupArea = document.getElementById('sync-setup-area');
  const connectedArea = document.getElementById('sync-connected-area');
  const statusIndicator = document.querySelector('.status-indicator');
  const statusText = document.querySelector('.sync-status span');

  if (isConnected) {
    setupArea.classList.add('hidden');
    connectedArea.classList.remove('hidden');
    statusIndicator.className = 'status-indicator online';
    statusText.innerText = 'Connected to ' + conn.peer;
  } else {
    setupArea.classList.remove('hidden');
    connectedArea.classList.add('hidden');
    statusIndicator.className = 'status-indicator offline';
    statusText.innerText = 'Disconnected';
  }
}
