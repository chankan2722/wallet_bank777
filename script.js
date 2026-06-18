const firebaseConfig = {
    apiKey: "AIzaSyDnCsHUcEVUzOnLS8YGAaZl2hzws3DmfG8",
    authDomain: "wallet-babank777.firebaseapp.com",
    projectId: "wallet-babank777",
    storageBucket: "wallet-babank777.firebasestorage.app",
    messagingSenderId: "738311954072",
    appId: "1:738311954072:web:578f105ee40a54eaa87aed",
    measurementId: "G-2E1RMJ4VH4"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let currentUsername = "";
let txs = [];
let unsubscribeTxs = null; 
let unsubscribeUser = null;
let expenseChartInstance = null;

let userGoalAmount = 20000;
let userGoalMonths = 5;
let editingTxId = null;
let editingTxType = null; 
let viewMode = 'list'; 
let confirmActionCallback = null;

const FREE_LIMIT = 887878787; 

if (localStorage.getItem('theme') === 'dark') document.body.setAttribute('data-theme', 'dark');
function toggleTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
    renderChart();
}

// ==========================================
// 🌟 UI Utilities (Toast, Confirm Modal, Loading)
// ==========================================
function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
    toast.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => { if(container.contains(toast)) container.removeChild(toast); }, 3500);
}

function showConfirmModal(title, msg, onConfirm) {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-message').innerText = msg;
    document.getElementById('confirm-modal').style.display = 'flex';
    confirmActionCallback = onConfirm;
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    confirmActionCallback = null;
}

document.getElementById('confirm-yes-btn').addEventListener('click', () => {
    if(confirmActionCallback) confirmActionCallback();
    closeConfirmModal();
});

function setLoading(btnId, isLoading) {
    const btn = document.getElementById(btnId);
    if(!btn) return;
    if(isLoading) btn.classList.add('btn-loading');
    else btn.classList.remove('btn-loading');
}

// ==========================================
// Authentication
// ==========================================
function toggleAuth(mode) {
    document.getElementById('auth-login-box').style.display = 'none';
    document.getElementById('auth-register-box').style.display = 'none';
    document.getElementById('auth-reset-box').style.display = 'none';
    document.querySelectorAll('.error-msg').forEach(el => el.style.display = 'none');
    
    if(mode === 'login') document.getElementById('auth-login-box').style.display = 'block';
    if(mode === 'register') document.getElementById('auth-register-box').style.display = 'block';
    if(mode === 'reset') document.getElementById('auth-reset-box').style.display = 'block';
}

function registerNewUser() {
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-password').value;
    const errDiv = document.getElementById('reg-error');
    if(!username || !email || !pass) { errDiv.innerText = "กรุณากรอกข้อมูลให้ครบถ้วน"; errDiv.style.display = 'block'; return; }

    setLoading('btn-register', true);
    db.collection('users').where('username', '==', username).get()
    .then(snapshot => {
        if(!snapshot.empty) throw new Error("ชื่อผู้ใช้งานนี้ถูกใช้ไปแล้ว โปรดเปลี่ยนใหม่");
        return auth.createUserWithEmailAndPassword(email, pass);
    })
    .then((userCredential) => {
        return db.collection('users').doc(userCredential.user.uid).set({
        username: username,
        email: email,
        isAdmin: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    })
    .then(() => showToast(`ยินดีต้อนรับคุณ ${username}`, 'success'))
    .catch(err => { errDiv.innerText = err.message; errDiv.style.display = 'block'; })
    .finally(() => setLoading('btn-register', false));
}

function loginWithUsername() {
    const username = document.getElementById('login-username').value.trim();
    const pass = document.getElementById('login-password').value;
    const errDiv = document.getElementById('login-error');
    if(!username || !pass) { errDiv.innerText = "กรุณากรอก Username และ รหัสผ่าน"; errDiv.style.display = 'block'; return; }

    setLoading('btn-login', true);
    db.collection('users').where('username', '==', username).get()
    .then(snapshot => {
        if(snapshot.empty) throw new Error("ไม่พบชื่อผู้ใช้งานนี้ในระบบ");
        const email = snapshot.docs[0].data().email;
        return auth.signInWithEmailAndPassword(email, pass);
    })
    .catch(err => { errDiv.innerText = err.message; errDiv.style.display = 'block'; })
    .finally(() => setLoading('btn-login', false));
}

function resetPassword() {
    const email = document.getElementById('reset-email').value.trim();
    const errDiv = document.getElementById('reset-error');
    if(!email) { errDiv.innerText = "กรุณากรอกอีเมลก่อนกดส่งลิงก์"; errDiv.style.display = 'block'; return; }
    
    setLoading('btn-reset', true);
    auth.sendPasswordResetEmail(email).then(() => {
        errDiv.style.display = 'none'; 
        showToast("ส่งลิงก์ตั้งรหัสใหม่ไปที่อีเมลแล้ว", 'info');
        toggleAuth('login');
    }).catch(error => { 
        errDiv.innerText = error.message; errDiv.style.display = 'block'; 
    }).finally(() => setLoading('btn-reset', false));
}

function logout() { auth.signOut(); }

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        document.getElementById('login-screen').style.display = 'none';
        listenToUserData();
        listenToTransactions();
    } else {
        currentUser = null; currentUsername = "";
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app-screen').style.display = 'none';
        document.getElementById('admin-screen').style.display = 'none';
        txs = [];
        if (unsubscribeTxs) unsubscribeTxs(); 
        if (unsubscribeUser) unsubscribeUser();
    }
});

// ==========================================
// Admin & User Screen Logic
// ==========================================
function listenToUserData() {
    unsubscribeUser = db.collection('users').doc(currentUser.uid).onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            if (data.goalAmount) userGoalAmount = data.goalAmount;
            if (data.goalMonths) userGoalMonths = data.goalMonths;
            if (data.username) {
                currentUsername = data.username;
                document.getElementById('user-display-name').innerText = "คุณ " + data.username; 
                
                if(currentUsername.toLowerCase() === 'admin' || data.isAdmin === true) {
                    document.getElementById('app-screen').style.display = 'none';
                    document.getElementById('admin-screen').style.display = 'block';
                    loadAdminData();
                    return;
                } else {
                    document.getElementById('admin-screen').style.display = 'none';
                    document.getElementById('app-screen').style.display = 'grid';
                }
            }
        }
        updateUI();
    });
}

function loadAdminData() {
    db.collection('users').get().then(snap => {
        document.getElementById('admin-total-users').innerText = snap.size + " บัญชี";
        let html = '';
        snap.forEach(doc => {
            const d = doc.data();
            const date = (d.createdAt && d.createdAt.toDate) ? d.createdAt.toDate().toLocaleDateString('th-TH') : '-';
            const email = d.email || '';
            const uname = d.username || 'No Name';
            html += `<tr>
                <td><span style="font-size:11px; color:var(--text-secondary); font-family: monospace;">${doc.id}</span></td>
                <td><b style="color: #6366f1;">${uname}</b></td>
                <td>${email || '-'}</td>
                <td>${(d.goalAmount || 20000).toLocaleString()} THB</td>
                <td>${date}</td>
                <td style="text-align: right; display: flex; gap: 6px; justify-content: flex-end;">
                    <button class="btn-outline" style="padding: 4px 8px; font-size: 11px;" onclick="adminResetPassword('${email}')">🔑 รีเซ็ต</button>
                    <button class="btn-del" style="padding: 4px 8px; font-size: 11px; background: rgba(244, 63, 94, 0.1);" onclick="adminDeleteUser('${doc.id}', '${uname}')">🗑️ ลบ</button>
                </td>
            </tr>`;
        });
        document.querySelector('#admin-users-table tbody').innerHTML = html;
    }).catch(err => showToast("โหลดข้อมูลแอดมินล้มเหลว", 'error'));
}

function adminResetPassword(email) {
    if(!email) return;
    showConfirmModal("รีเซ็ตรหัสผ่าน", `ส่งลิงก์รีเซ็ตรหัสผ่านไปที่ ${email} หรือไม่?`, () => {
        auth.sendPasswordResetEmail(email)
            .then(() => showToast("ส่งลิงก์สำเร็จ!", 'success'))
            .catch(err => showToast("เกิดข้อผิดพลาด: " + err.message, 'error'));
    });
}

function adminDeleteUser(uid, username) {
    showConfirmModal("ลบข้อมูลผู้ใช้งาน", `คุณแน่ใจหรือไม่ที่จะลบข้อมูลของ "${username}"? (โปรไฟล์จะหายไปทันที)`, () => {
        db.collection('users').doc(uid).delete().then(() => {
            showToast("ลบข้อมูลสำเร็จ", 'success');
            loadAdminData(); 
        }).catch(err => showToast("ลบล้มเหลว: (อย่าลืมแก้ Firebase Rules ก่อนนะครับ!) " + err.message, 'error'));
    });
}

// ==========================================
// User Settings (เปลี่ยนรหัสผ่าน)
// ==========================================
function openSettingsModal() { document.getElementById('settings-new-password').value = ''; document.getElementById('settings-modal').style.display = 'flex'; }
function closeSettingsModal() { document.getElementById('settings-modal').style.display = 'none'; }

function updateUserPassword() {
    const newPass = document.getElementById('settings-new-password').value;
    if(newPass.length < 6) return showToast("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร", 'error');
    
    setLoading('btn-save-settings', true);
    auth.currentUser.updatePassword(newPass).then(() => {
        showToast("เปลี่ยนรหัสผ่านสำเร็จ!", 'success');
        closeSettingsModal();
    }).catch(err => {
        if(err.code === 'auth/requires-recent-login') showToast("กรุณาล็อกเอาท์และล็อกอินใหม่ก่อนเปลี่ยนรหัสผ่าน", 'error');
        else showToast(err.message, 'error');
    }).finally(() => setLoading('btn-save-settings', false));
}

// ==========================================
// Transaction Logics
// ==========================================
function listenToTransactions() {
    const ref = db.collection('users').doc(currentUser.uid).collection('transactions').orderBy('createdAt', 'desc');
    unsubscribeTxs = ref.onSnapshot(snapshot => {
        txs = [];
        snapshot.forEach(doc => { txs.push({ id: doc.id, ...doc.data() }); });
        updateUI();
    });
}

function toggleViewMode() { viewMode = viewMode === 'list' ? 'table' : 'list'; updateUI(); }
function openGoalModal() { document.getElementById('goal-input-amount').value = userGoalAmount; document.getElementById('goal-input-months').value = userGoalMonths; document.getElementById('goal-modal').style.display = 'flex'; }
function closeGoalModal() { document.getElementById('goal-modal').style.display = 'none'; }
function saveGoal() {
    const amt = parseFloat(document.getElementById('goal-input-amount').value);
    const months = parseInt(document.getElementById('goal-input-months').value);
    if(isNaN(amt) || isNaN(months) || amt <= 0 || months <= 0) return showToast("กรุณากรอกตัวเลขให้ถูกต้อง", 'error');
    db.collection('users').doc(currentUser.uid).set({ goalAmount: amt, goalMonths: months }, { merge: true })
    .then(() => { showToast("อัปเดตเป้าหมายแล้ว", 'success'); closeGoalModal(); });
}

function addTx(type) {
    if (!currentUser) return;
    const rawDesc = document.getElementById('desc').value.trim();
    const amt = parseFloat(document.getElementById('amount').value);
    if (!rawDesc || isNaN(amt) || amt <= 0) return showToast("กรุณากรอกข้อมูลให้ครบ", 'error');

    setLoading(type === 'inc' ? 'btn-inc' : 'btn-exp', true);
    const hashtagMatches = rawDesc.match(/#[ก-๙a-zA-Z0-9_]+/g);
    const tags = hashtagMatches ? hashtagMatches.map(t => t.replace('#', '')) : [];
    const primaryCat = tags.length > 0 ? tags[0] : ''; 
    let cleanDesc = rawDesc.replace(/#[ก-๙a-zA-Z0-9_]+\s*/g, '').trim();
    if (cleanDesc === '') cleanDesc = tags.length > 0 ? tags.join(', ') : 'ไม่มีรายละเอียด';

    db.collection('users').doc(currentUser.uid).collection('transactions').add({
        desc: cleanDesc, amt: amt, type: type, cat: primaryCat, tags: tags,
        date: new Date().toISOString(), createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        showToast("บันทึกสำเร็จ", 'success');
        document.getElementById('desc').value = ''; document.getElementById('amount').value = ''; document.getElementById('desc').focus();
    }).finally(() => setLoading(type === 'inc' ? 'btn-inc' : 'btn-exp', false));
}

function editTx(id) {
    const tx = txs.find(t => t.id === id);
    if(!tx) return;
    editingTxId = id; editingTxType = tx.type; 
    let tagsString = '';
    if (tx.tags && tx.tags.length > 0) tagsString = ' #' + tx.tags.join(' #');
    else if (tx.cat) tagsString = ' #' + tx.cat; 
    
    document.getElementById('desc').value = tx.desc + tagsString;
    document.getElementById('amount').value = tx.amt;
    document.getElementById('action-add-mode').style.display = 'none';
    document.getElementById('action-edit-mode').style.display = 'flex';
}

function cancelEdit() {
    editingTxId = null; editingTxType = null;
    document.getElementById('desc').value = ''; document.getElementById('amount').value = '';
    document.getElementById('action-add-mode').style.display = 'flex'; document.getElementById('action-edit-mode').style.display = 'none';
}

function saveEditTx() {
    if(!editingTxId) return;
    const rawDesc = document.getElementById('desc').value.trim();
    const amt = parseFloat(document.getElementById('amount').value);
    if (!rawDesc || isNaN(amt) || amt <= 0) return showToast("กรุณากรอกข้อมูลให้ครบ", 'error');

    setLoading('btn-save-edit', true);
    const hashtagMatches = rawDesc.match(/#[ก-๙a-zA-Z0-9_]+/g);
    const tags = hashtagMatches ? hashtagMatches.map(t => t.replace('#', '')) : [];
    const primaryCat = tags.length > 0 ? tags[0] : ''; 
    let cleanDesc = rawDesc.replace(/#[ก-๙a-zA-Z0-9_]+\s*/g, '').trim();
    if (cleanDesc === '') cleanDesc = tags.length > 0 ? tags.join(', ') : 'ไม่มีรายละเอียด';

    db.collection('users').doc(currentUser.uid).collection('transactions').doc(editingTxId).update({
        desc: cleanDesc, amt: amt, cat: primaryCat, tags: tags
    }).then(() => {
        showToast("แก้ไขสำเร็จ", 'success');
        cancelEdit();
    }).finally(() => setLoading('btn-save-edit', false));
}

function delTx(id) {
    if (!currentUser) return;
    showConfirmModal("ลบรายการ", "แน่ใจหรือไม่ว่าต้องการลบรายการบัญชีนี้?", () => {
        db.collection('users').doc(currentUser.uid).collection('transactions').doc(id).delete()
        .then(() => showToast("ลบรายการแล้ว", 'info'));
    });
}

function handleEnterPress(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        if (editingTxId) saveEditTx(); else { event.shiftKey ? addTx('exp') : addTx('inc'); }
    }
}
document.getElementById('amount').addEventListener('keydown', handleEnterPress);
document.getElementById('desc').addEventListener('keydown', handleEnterPress);

// ==========================================
// UI & Render 
// ==========================================
function updateUI() {
    if(currentUsername.toLowerCase() === 'admin') return; 
    
    const monthSelect = document.getElementById('month-filter');
    const currentFilter = monthSelect.value;
    const months = new Set();
    
    txs.forEach(t => {
        if(t.date) {
            const d = new Date(t.date);
            months.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}`);
        }
    });
    
    let optionsHtml = '<option value="all">ทุกเดือน</option>';
    Array.from(months).sort().reverse().forEach(m => {
        const [yyyy, mm] = m.split('-');
        const dateObj = new Date(yyyy, mm - 1);
        optionsHtml += `<option value="${m}" ${currentFilter === m ? 'selected' : ''}>${dateObj.toLocaleDateString('th-TH', { month: 'short', year: 'numeric' })}</option>`;
    });
    monthSelect.innerHTML = optionsHtml;

    const filterText = monthSelect.options[monthSelect.selectedIndex].text;
    document.getElementById('lbl-tot-inc').innerText = `รายรับรวม (${filterText})`;
    document.getElementById('lbl-tot-exp').innerText = `รายจ่ายรวม (${filterText})`;

    renderList(); renderChart();
}

function renderList() {
    let inc = 0, exp = 0, allTimeBalance = 0;
    const histList = document.getElementById('history-list'); histList.innerHTML = '';
    let tableHtml = '';
    
    document.getElementById('history-list').style.display = viewMode === 'list' ? 'flex' : 'none';
    document.getElementById('history-table-wrapper').style.display = viewMode === 'table' ? 'block' : 'none';

    const searchTerm = document.getElementById('search').value.toLowerCase();
    const filterMonth = document.getElementById('month-filter').value;

    txs.forEach(t => { allTimeBalance += (t.type === 'inc' ? t.amt : -t.amt); });

    const filteredTxs = txs.filter(t => {
        const matchSearch = t.desc.toLowerCase().includes(searchTerm) || 
                            (t.tags && t.tags.some(tag => tag.toLowerCase().includes(searchTerm.replace('#', '')))) || 
                            (t.cat && t.cat.toLowerCase().includes(searchTerm.replace('#', '')));
        let matchMonth = true;
        if (filterMonth !== 'all' && t.date) {
            const d = new Date(t.date);
            matchMonth = (`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}` === filterMonth);
        }
        return matchSearch && matchMonth;
    });

    if (filteredTxs.length === 0) {
        histList.innerHTML = '<div class="empty-state">ไม่พบรายการ</div>';
        tableHtml = '<tr><td colspan="6" class="empty-state">ไม่พบรายการ</td></tr>';
    }

    filteredTxs.forEach(t => {
        if (t.type === 'inc') inc += t.amt; else exp += t.amt;
        
        let badgeHtml = '';
        if (t.tags && t.tags.length > 0) badgeHtml = t.tags.map(tag => `<div class="category-badge">#${tag}</div>`).join('');
        else if (t.cat) badgeHtml = `<div class="category-badge">#${t.cat}</div>`; 
        
        let dateStr = t.date ? new Date(t.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';
        
        const div = document.createElement('div');
        div.className = 'list-item';
        const amountClass = t.type === 'inc' ? 'text-success' : 'text-danger';
        const sign = t.type === 'inc' ? '+' : '-';
        
        div.innerHTML = `
            <div class="item-left">
                <div class="item-title">${t.desc}</div>
                <div class="item-meta"><span class="item-date">${dateStr}</span><div class="tags-wrapper">${badgeHtml}</div></div>
            </div>
            <div class="item-right">
                <div class="item-amount ${amountClass}" style="margin-right: 10px;">${sign}${t.amt.toLocaleString()}</div>
                <div class="action-icons">
                    <button class="btn-edit" onclick="downloadSlip('${t.id}')" title="โหลดสลิป">📥</button>
                    <button class="btn-edit" onclick="editTx('${t.id}')" title="แก้ไข">✏️</button>
                    <button class="btn-del" onclick="delTx('${t.id}')" title="ลบ">✕</button>
                </div>
            </div>
        `;
        histList.appendChild(div);

        tableHtml += `
            <tr>
                <td style="color: var(--text-secondary);">${dateStr}</td>
                <td><b>${t.desc}</b></td>
                <td><div class="tags-wrapper">${badgeHtml}</div></td>
                <td class="text-success" style="font-weight: 600;">${t.type === 'inc' ? '+' + t.amt.toLocaleString() : '-'}</td>
                <td class="text-danger" style="font-weight: 600;">${t.type === 'exp' ? '-' + t.amt.toLocaleString() : '-'}</td>
                <td style="text-align: right;">
                    <button class="btn-edit" onclick="downloadSlip('${t.id}')" title="โหลดสลิป">📥</button>
                    <button class="btn-edit" onclick="editTx('${t.id}')" title="แก้ไข">✏️</button>
                    <button class="btn-del" onclick="delTx('${t.id}')" title="ลบ">✕</button>
                </td>
            </tr>
        `;
    });

    document.querySelector('#history-table tbody').innerHTML = tableHtml;
    document.getElementById('tot-inc').innerText = '+' + inc.toLocaleString();
    document.getElementById('tot-exp').innerText = '-' + exp.toLocaleString();
    document.getElementById('balance').innerText = allTimeBalance.toLocaleString(); 

    const GOAL_TOTAL_DAYS = userGoalMonths * 30; 
    let progress = (allTimeBalance / userGoalAmount) * 100;
    progress = Math.max(0, Math.min(progress, 100)); 
    document.getElementById('goal-bar').style.width = `${progress}%`;
    document.getElementById('goal-text').innerText = allTimeBalance > 0 ? allTimeBalance.toLocaleString() : 0;
    document.getElementById('goal-target-text').innerText = userGoalAmount.toLocaleString();
    document.getElementById('goal-timeline-badge').innerText = `กรอบเวลา ${userGoalMonths} เดือน`;

    const remainingAmt = Math.max(0, userGoalAmount - allTimeBalance);
    const runRateText = document.getElementById('run-rate-text');
    if (remainingAmt === 0 && allTimeBalance > 0) {
        runRateText.innerText = `🎉 คุณทำถึงเป้าหมาย ${userGoalAmount.toLocaleString()} บาทแล้ว!`;
        runRateText.style.color = 'var(--success)';
    } else {
        const weeklyRate = (remainingAmt / (GOAL_TOTAL_DAYS / 7)).toFixed(0);
        runRateText.innerText = `💡 ควรเก็บเพิ่มเฉลี่ย ${Number(weeklyRate).toLocaleString()} บาท/สัปดาห์`;
        runRateText.style.color = 'var(--text-secondary)';
    }
}

function renderChart() {
    const ctx = document.getElementById('expenseChart').getContext('2d');
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const expenseByCat = {};
    
    txs.filter(t => t.type === 'exp').forEach(t => {
        const primaryTag = (t.tags && t.tags.length > 0) ? t.tags[0] : (t.cat ? t.cat : 'อื่นๆ');
        const catLabel = `#${primaryTag}`;
        expenseByCat[catLabel] = (expenseByCat[catLabel] || 0) + t.amt;
    });

    const labels = Object.keys(expenseByCat);
    const data = Object.values(expenseByCat);

    if (expenseChartInstance) expenseChartInstance.destroy();
    const emptyColor = isDark ? '#1f2937' : '#f3f4f6';
    const lineColor = '#6366f1'; 

    expenseChartInstance = new Chart(ctx, {
        type: 'line', 
        data: {
            labels: labels.length > 0 ? labels : ['ยังไม่มีรายการ'],
            datasets: [{
                label: 'รายจ่าย (บาท)', data: data.length > 0 ? data : [0],
                borderColor: data.length > 0 ? lineColor : emptyColor,
                backgroundColor: data.length > 0 ? `${lineColor}33` : emptyColor, 
                borderWidth: 2, pointBackgroundColor: isDark ? '#111827' : '#ffffff', 
                pointBorderColor: data.length > 0 ? lineColor : emptyColor, pointBorderWidth: 2,
                pointRadius: 4, pointHoverRadius: 6, fill: true, tension: 0.3 
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: data.length > 0, backgroundColor: isDark ? '#111827' : '#ffffff', titleColor: isDark ? '#ffffff' : '#111827', bodyColor: isDark ? '#d1d5db' : '#4b5563', borderColor: isDark ? '#374151' : '#e5e7eb', borderWidth: 1, padding: 12, boxPadding: 6 } },
            scales: {
                y: { beginAtZero: true, grid: { color: isDark ? '#374151' : '#e5e7eb', drawBorder: false, }, ticks: { color: isDark ? '#9ca3af' : '#6b7280', font: { family: 'Inter' } } },
                x: { grid: { display: false }, ticks: { color: isDark ? '#9ca3af' : '#6b7280', font: { family: 'Inter', size: 12 } } }
            }
        }
    });
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) { showToast("รองรับเฉพาะไฟล์ .csv เท่านั้น", 'error'); event.target.value = ''; return; }
    
    setLoading('btn-import-csv', true);
    const reader = new FileReader();
    reader.onload = function(e) { 
        processCSVData(e.target.result); 
        setLoading('btn-import-csv', false);
    };
    reader.readAsText(file);
}

function processCSVData(csvText) {
    if (!currentUser) return;
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return showToast("ไฟล์ว่างเปล่า", 'error');

    const batch = db.batch();
    const txsRef = db.collection('users').doc(currentUser.uid).collection('transactions');
    let addedCount = 0;

    lines.forEach((line, index) => {
        if(index === 0 && (line.includes('รายละเอียด') || line.includes('desc'))) return; 
        const cols = line.split(',');
        
        if (cols.length >= 2) {
            const desc = cols[0].trim();
            const amt = parseFloat(cols[1].trim());
            const typeRaw = cols[2] ? cols[2].trim().toLowerCase() : '';
            const type = (typeRaw === 'inc' || typeRaw === 'รายรับ') ? 'inc' : 'exp';
            const catRaw = cols[3] ? cols[3].trim() : '';
            const tags = catRaw !== '' ? catRaw.replace(/#/g, '').split(/\s+/) : []; 
            const primaryCat = tags.length > 0 ? tags[0] : '';
            const dateRaw = cols[4] ? cols[4].trim() : '';
            let dateStr = new Date().toISOString(); 
            if (dateRaw.match(/^\d{4}-\d{2}-\d{2}$/)) {
                const parsedDate = new Date(dateRaw);
                if (!isNaN(parsedDate)) dateStr = parsedDate.toISOString(); 
            }

            if (!isNaN(amt) && amt > 0 && desc !== '') {
                const newDocRef = txsRef.doc(); 
                batch.set(newDocRef, {
                    desc: desc, amt: amt, type: type, cat: primaryCat, tags: tags, date: dateStr,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                addedCount++;
            }
        }
    });

    if (addedCount > 0) {
        batch.commit().then(() => {
            showToast(`นำเข้าสำเร็จ ${addedCount} รายการ`, 'success');
            document.getElementById('file-upload').value = ''; 
        }).catch(err => showToast("เกิดข้อผิดพลาดในการบันทึก", 'error'));
    } else { showToast("ไม่พบข้อมูลที่ถูกต้องในไฟล์", 'error'); }
}

function exportToCSV() {
    if (!currentUser || txs.length === 0) return showToast("ยังไม่มีข้อมูลให้ส่งออก", 'info');
    
    setLoading('btn-export-csv', true);
    let csvContent = "\uFEFFวันที่,รายละเอียด,จำนวนเงิน,ประเภท,แฮชแท็ก\n";
    txs.forEach(t => {
        const d = t.date ? new Date(t.date).toLocaleDateString('th-TH') : '';
        const desc = `"${t.desc.replace(/"/g, '""')}"`; 
        let tagsStr = '';
        if (t.tags && t.tags.length > 0) tagsStr = t.tags.join(' ');
        else if (t.cat) tagsStr = t.cat;
        const typeStr = t.type === 'inc' ? 'รายรับ' : 'รายจ่าย';
        csvContent += `${d},${desc},${t.amt},${typeStr},${tagsStr}\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "minimal_ledger_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setTimeout(() => setLoading('btn-export-csv', false), 500);
}

// ==========================================
// 📸 E-Slip Generator (สร้างรูปภาพใบเสร็จ)
// ==========================================
function downloadSlip(id) {
    const tx = txs.find(t => t.id === id);
    if(!tx) return;
    
    showToast("กำลังสร้างสลิป...", 'info');
    
    // ใส่ข้อมูลลงในแม่แบบสลิป
    const slipAmt = document.getElementById('slip-amount');
    slipAmt.innerText = (tx.type === 'inc' ? '+' : '-') + tx.amt.toLocaleString() + ' THB';
    slipAmt.style.color = tx.type === 'inc' ? '#10b981' : '#f43f5e';
    
    document.getElementById('slip-desc').innerText = tx.desc;
    document.getElementById('slip-date').innerText = new Date(tx.date).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
    document.getElementById('slip-user').innerText = currentUsername;
    
    // แปลง HTML เป็นรูปภาพ
    const slipCard = document.getElementById('slip-card');
    html2canvas(slipCard, { scale: 3, backgroundColor: null }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Minimal_Ledger_Slip_${tx.id.substring(0,6)}.png`; 
        link.href = canvas.toDataURL('image/png');
        link.click(); 
        showToast("ดาวน์โหลดสลิปสำเร็จ! 🎉", 'success');
    }).catch(err => {
        showToast("เกิดข้อผิดพลาดในการสร้างสลิป", 'error');
    });
}