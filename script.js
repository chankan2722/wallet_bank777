const firebaseConfig = {
    apiKey: "AIzaSyDnCsHUcEVUzOnLS8YGAaZl2hzws3DmfG8",
    authDomain: "wallet-babank777.firebaseapp.com",
    projectId: "wallet-babank777",
    storageBucket: "wallet-babank777.firebasestorage.app",
    messagingSenderId: "738311954072",
    appId: "1:738311954072:web:578f105ee40a54eaa87aed"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();

let currentUser = null; let currentUsername = ""; let currentUserRole = "user"; 
let txs = []; let unsubscribeTxs = null; let unsubscribeUser = null; let expenseChartInstance = null;
let userGoalAmount = 20000; let userGoalMonths = 5; let editingTxId = null; let viewMode = 'list'; let confirmActionCallback = null;
let userBudgets = {};
let isAdminView = false; 

let currentCurrency = 'THB';
const currencyRates = { THB: 1, USD: 0.027, JPY: 4.3 };
function changeCurrency() { currentCurrency = document.getElementById('currency-select').value; document.querySelectorAll('.currency').forEach(el => el.innerText = currentCurrency); updateUI(); }
if (localStorage.getItem('theme') === 'dark') document.body.setAttribute('data-theme', 'dark');
function toggleTheme() { const isDark = document.body.getAttribute('data-theme') === 'dark'; document.body.setAttribute('data-theme', isDark ? 'light' : 'dark'); localStorage.setItem('theme', isDark ? 'light' : 'dark'); renderChart(); }

function showToast(msg, type = 'success') { const container = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = `toast ${type}`; const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️'); toast.innerHTML = `<span>${icon}</span> <span>${msg}</span>`; container.appendChild(toast); setTimeout(() => { if(container.contains(toast)) container.removeChild(toast); }, 3500); }
function showConfirmModal(title, msg, onConfirm) { document.getElementById('confirm-title').innerText = title; document.getElementById('confirm-message').innerText = msg; document.getElementById('confirm-modal').style.display = 'flex'; confirmActionCallback = onConfirm; }
function closeConfirmModal() { document.getElementById('confirm-modal').style.display = 'none'; confirmActionCallback = null; }
document.getElementById('confirm-yes-btn').addEventListener('click', () => { if(confirmActionCallback) confirmActionCallback(); closeConfirmModal(); });
function setLoading(btnId, isLoading) { const btn = document.getElementById(btnId); if(!btn) return; if(isLoading) btn.classList.add('btn-loading'); else btn.classList.remove('btn-loading'); }

// ==========================================
// 🔐 Authentication
// ==========================================
function toggleAuth(mode) { document.querySelectorAll('.auth-card').forEach(el => el.style.display = 'none'); document.querySelectorAll('.error-msg').forEach(el => el.style.display = 'none'); document.getElementById('auth-' + mode + '-box').style.display = 'block'; }

function registerNewUser() {
    const username = document.getElementById('reg-username').value.trim(); const email = document.getElementById('reg-email').value.trim(); const pass = document.getElementById('reg-password').value; const errDiv = document.getElementById('reg-error');
    if(!username || !email || !pass) return errDiv.innerText = "กรุณากรอกให้ครบ", errDiv.style.display = 'block'; setLoading('btn-register', true);
    db.collection('users').where('username', '==', username).get().then(snapshot => {
        if(!snapshot.empty) throw new Error("ชื่อผู้ใช้งานนี้ถูกใช้ไปแล้ว"); return auth.createUserWithEmailAndPassword(email, pass);
    }).then((userCredential) => { return db.collection('users').doc(userCredential.user.uid).set({ username: username, email: email, isAdmin: false, isSuspended: false, isDeleted: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    }).then(() => showToast(`ยินดีต้อนรับ ${username}`, 'success')).catch(err => { errDiv.innerText = err.message; errDiv.style.display = 'block'; }).finally(() => setLoading('btn-register', false));
}

function loginWithUsername() {
    const loginInput = document.getElementById('login-username').value.trim(); const pass = document.getElementById('login-password').value; const errDiv = document.getElementById('login-error');
    if(!loginInput || !pass) return errDiv.innerText = "กรอกข้อมูลให้ครบ", errDiv.style.display = 'block'; setLoading('btn-login', true);
    if (loginInput.includes('@')) { auth.signInWithEmailAndPassword(loginInput, pass).catch(err => { errDiv.innerText = "อีเมลหรือรหัสผ่านผิด"; errDiv.style.display = 'block'; }).finally(() => setLoading('btn-login', false));
    } else {
        db.collection('users').where('username', '==', loginInput).get().then(snapshot => {
            if(snapshot.empty) throw new Error("ไม่พบชื่อผู้ใช้นี้"); return auth.signInWithEmailAndPassword(snapshot.docs[0].data().email, pass);
        }).catch(err => { errDiv.innerText = err.message; errDiv.style.display = 'block'; }).finally(() => setLoading('btn-login', false));
    }
}
function resetPassword() { const email = document.getElementById('reset-email').value.trim(); const errDiv = document.getElementById('reset-error'); if(!email) { errDiv.innerText = "กรุณากรอกอีเมล"; errDiv.style.display = 'block'; return; } setLoading('btn-reset', true); auth.sendPasswordResetEmail(email).then(() => { errDiv.style.display = 'none'; showToast("ส่งลิงก์ไปที่อีเมลแล้ว", 'info'); toggleAuth('login'); }).catch(error => { errDiv.innerText = error.message; errDiv.style.display = 'block'; }).finally(() => setLoading('btn-reset', false)); }
function logout() { auth.signOut(); }

auth.onAuthStateChanged(user => {
    if (user) { currentUser = user; document.getElementById('login-screen').style.display = 'none'; listenToUserData(); listenToTransactions(); } 
    else { currentUser = null; currentUsername = ""; document.getElementById('login-screen').style.display = 'flex'; document.getElementById('app-screen').style.display = 'none'; txs = []; if (unsubscribeTxs) unsubscribeTxs(); if (unsubscribeUser) unsubscribeUser(); }
});

// ==========================================
// 🛡️ User Data & SaaS Role Management
// ==========================================
function listenToUserData() {
    unsubscribeUser = db.collection('users').doc(currentUser.uid).onSnapshot(doc => {
        if (!doc.exists) return; const data = doc.data();
        if (data.isDeleted === true || data.isSuspended === true) { alert("⚠️ บัญชีของคุณถูกระงับการใช้งาน"); return logout(); }
        if (data.goalAmount) userGoalAmount = data.goalAmount; 
        if (data.goalMonths) userGoalMonths = data.goalMonths;
        if (data.budgets) userBudgets = data.budgets; else userBudgets = {};
        currentUsername = data.username || "User"; document.getElementById('user-display-name').innerText = currentUsername; 
        
        const viewDash = document.getElementById('view-dashboard');
        const viewAdmin = document.getElementById('view-admin');
        viewDash.style.display = ''; viewAdmin.style.display = ''; 
        
        if (data.isAdmin === true) {
            currentUserRole = "admin"; document.getElementById('btn-admin-panel').style.display = 'inline-block'; 
            document.getElementById('role-badge').innerText = "ADMIN"; document.getElementById('role-badge').style.background = "var(--danger)";
            loadAdminData(); 
            if(!isAdminView) { viewDash.classList.remove('hidden-view'); viewAdmin.classList.add('hidden-view'); }
        } else {
            currentUserRole = "user"; document.getElementById('btn-admin-panel').style.display = 'none';
            document.getElementById('role-badge').innerText = "USER"; document.getElementById('role-badge').style.background = "var(--text-primary)";
            isAdminView = false; viewDash.classList.remove('hidden-view'); viewAdmin.classList.add('hidden-view');
        }
        
        if (data.sysAnnounce) { document.getElementById('sys-announcement').style.display = 'block'; document.getElementById('sys-announcement-text').innerText = data.sysAnnounce; } 
        else { document.getElementById('sys-announcement').style.display = 'none'; }
        
        document.getElementById('app-screen').style.display = 'flex';
        updateUI();
    });
}

function toggleAdminPanel() {
    isAdminView = !isAdminView;
    const viewDash = document.getElementById('view-dashboard');
    const viewAdmin = document.getElementById('view-admin');

    if(isAdminView) {
        viewDash.classList.add('hidden-view');
        viewAdmin.classList.remove('hidden-view');
        document.getElementById('btn-admin-panel').innerText = '⬅ กลับหน้า Dashboard';
        document.getElementById('btn-admin-panel').style.background = 'var(--text-primary)';
    } else {
        viewDash.classList.remove('hidden-view');
        viewAdmin.classList.add('hidden-view');
        document.getElementById('btn-admin-panel').innerText = '🛡️ Admin Panel';
        document.getElementById('btn-admin-panel').style.background = 'var(--danger)';
    }
}

// ==========================================
// 🛠️ ADMIN PANEL FUNCTIONS
// ==========================================
let adminUsersData = [];

function loadAdminData() {
    db.collection('users').orderBy('createdAt', 'desc').get().then(snap => {
        adminUsersData = []; let totalGoalsAmount = 0;
        snap.forEach(doc => { const data = doc.data(); if (data.isDeleted !== true) { data.uid = doc.id; adminUsersData.push(data); totalGoalsAmount += (data.goalAmount || 20000); } });
        document.getElementById('admin-total-users').innerText = adminUsersData.length.toLocaleString(); document.getElementById('admin-total-goals').innerText = totalGoalsAmount.toLocaleString() + " THB";
        renderAdminUsersTable(adminUsersData);
    });
}

function renderAdminUsersTable(usersArray) {
    let html = '';
    usersArray.forEach(d => {
        const date = (d.createdAt && d.createdAt.toDate) ? d.createdAt.toDate().toLocaleDateString('th-TH') : '-';
        const isAdmin = d.isAdmin === true; const isSuspended = d.isSuspended === true;
        const roleBadge = isAdmin ? '<span class="badge-pro" style="background:var(--danger)">Admin</span>' : '<span class="badge-pro" style="background:var(--success)">User</span>';
        const statusBadge = isSuspended ? '<span style="color:var(--danger); font-weight: bold;">🔴 ระงับ</span>' : '<span style="color:var(--success); font-weight: bold;">🟢 ปกติ</span>';

        html += `<tr>
            <td><span style="font-size:11px; font-family: monospace;" title="${d.uid}">${d.uid.substring(0,6)}...</span></td>
            <td><b>${d.username||'-'}</b></td><td>${d.email||'-'}</td><td>${roleBadge}</td><td>${statusBadge}</td>
            <td style="white-space: nowrap; text-align: right;">
                <div style="display: inline-flex; gap: 4px; justify-content: flex-end;">
                    <button class="btn-outline" style="padding: 4px 8px; font-size: 11px;" onclick="toggleAdminRole('${d.uid}', ${isAdmin})" title="สลับสิทธิ์">⭐ Role</button>
                    <button class="btn-outline" style="padding: 4px 8px; font-size: 11px;" onclick="toggleSuspendUser('${d.uid}', ${isSuspended})" title="ระงับบัญชี">🚫 Ban</button>
                    <button class="btn-outline" style="padding: 4px 8px; font-size: 11px; color: var(--danger);" onclick="clearUserTransactions('${d.uid}', '${d.username||''}')" title="ล้างธุรกรรม">🧹</button>
                    <button class="btn-del" style="padding: 4px 8px; font-size: 11px; background: rgba(239, 68, 68, 0.1);" onclick="softDeleteUser('${d.uid}', '${d.username||''}')" title="ลงถังขยะ">🗑️</button>
                </div>
            </td>
        </tr>`;
    });
    document.querySelector('#admin-users-table tbody').innerHTML = html;
}

function filterAdminUsers() { const term = document.getElementById('admin-search-user').value.toLowerCase(); const filtered = adminUsersData.filter(u => (u.username||'').toLowerCase().includes(term) || (u.email||'').toLowerCase().includes(term)); renderAdminUsersTable(filtered); }
function addAuditLog(actionMsg) { const logBox = document.getElementById('admin-audit-log'); const time = new Date().toLocaleTimeString('th-TH'); logBox.innerHTML = `<div><span style="color:var(--blue)">[${time}]</span> ${actionMsg}</div>` + logBox.innerHTML; }
function clearAuditLog() { document.getElementById('admin-audit-log').innerHTML = '<i>ไม่มีบันทึก...</i>'; showToast("ล้าง Log สำเร็จ", 'info'); }

function softDeleteUser(uid, username) {
    showConfirmModal("ย้ายลงถังขยะ (Soft Delete)", `บัญชี ${username} จะถูกระงับและซ่อนจากระบบ (กู้คืนได้)`, () => {
        db.collection('users').doc(uid).update({ isDeleted: true, isSuspended: true, deletedAt: new Date().toISOString() }).then(() => { showToast("ย้ายบัญชีลงถังขยะแล้ว", 'success'); addAuditLog(`🗑️ Soft Delete UID: ${uid.substring(0,6)}`); loadAdminData(); });
    });
}

function showRecycleBin() { document.getElementById('recycle-bin-modal').style.display = 'flex'; loadRecycleBinData(); }
function closeRecycleBin() { document.getElementById('recycle-bin-modal').style.display = 'none'; }

function loadRecycleBinData() {
    const tbody = document.querySelector('#recycle-bin-table tbody'); tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">กำลังโหลด...</td></tr>';
    db.collection('users').where('isDeleted', '==', true).get().then(snap => {
        let html = ''; if(snap.empty) { html = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">ถังขยะว่างเปล่า</td></tr>'; } 
        else { snap.forEach(doc => { const d = doc.data(); const date = d.deletedAt ? new Date(d.deletedAt).toLocaleDateString('th-TH') : '-'; html += `<tr><td><span style="font-size:11px; font-family: monospace;">${doc.id.substring(0,6)}...</span></td><td><b>${d.username||'-'}</b></td><td>${date}</td><td style="white-space: nowrap; text-align: right;"><div style="display: inline-flex; gap: 4px; justify-content: flex-end;"><button class="btn-outline" style="padding: 4px 8px; font-size: 11px; color: var(--success);" onclick="restoreUser('${doc.id}', '${d.username}')">♻️ กู้คืน</button><button class="btn-del" style="padding: 4px 8px; font-size: 11px; background: rgba(239,68,68,0.1);" onclick="hardDeleteUser('${doc.id}', '${d.username}')">🔥 ลบถาวร</button></div></td></tr>`; }); }
        tbody.innerHTML = html;
    });
}

function restoreUser(uid, username) { 
    closeRecycleBin(); // ✨ เพิ่มบรรทัดนี้ให้ปิดถังขยะก่อน
    showConfirmModal("กู้คืนบัญชี", `ต้องการกู้คืนบัญชี ${username} ใช่หรือไม่?`, () => { db.collection('users').doc(uid).update({ isDeleted: false, isSuspended: false }).then(() => { showToast("กู้คืนบัญชีสำเร็จ", "success"); addAuditLog(`♻️ กู้คืน UID: ${uid.substring(0,6)}`); loadRecycleBinData(); loadAdminData(); }); }); 
}

function hardDeleteUser(uid, username) { 
    closeRecycleBin(); // ✨ เพิ่มบรรทัดนี้ให้ปิดถังขยะก่อน
    showConfirmModal("ลบถาวร 🚨", `คำเตือน! ข้อมูลของ ${username} จะถูกลบทิ้งอย่างถาวรและกู้ไม่ได้ ยืนยันหรือไม่?`, () => { db.collection('users').doc(uid).delete().then(() => { showToast("ลบข้อมูลถาวรสำเร็จ", "success"); addAuditLog(`🔥 ลบถาวร UID: ${uid.substring(0,6)}`); loadRecycleBinData(); }); }); 
}

function clearUserTransactions(uid, username) {
    showConfirmModal("🚨 ล้างข้อมูลธุรกรรม", `กำลังล้างประวัติการเงินทั้งหมดของ ${username} ข้อมูลกู้ไม่ได้ ยืนยันหรือไม่?`, () => {
        showToast("กำลังล้างข้อมูล...", 'info');
        db.collection('users').doc(uid).collection('transactions').get().then(snap => { const batch = db.batch(); snap.forEach(doc => batch.delete(doc.ref)); return batch.commit(); }).then(() => { showToast("ล้างประวัติสำเร็จ", 'success'); addAuditLog(`🧹 ล้างธุรกรรม UID: ${uid.substring(0,6)}`); }).catch(e => showToast("Error: " + e.message, 'error'));
    });
}

function loadGlobalTransactions() {
    const tableBody = document.querySelector('#admin-global-tx-table tbody'); 
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">กำลังโหลด...</td></tr>';
    db.collection('users').get().then(snap => {
        let promises = [];
        snap.forEach(userDoc => {
            let p = db.collection('users').doc(userDoc.id).collection('transactions')
                .orderBy('createdAt', 'desc').limit(10).get()
                .then(txSnap => {
                    let userTxs = [];
                    txSnap.forEach(txDoc => { userTxs.push({ uid: userDoc.id, ...txDoc.data() }); });
                    return userTxs;
                });
            promises.push(p);
        });
        return Promise.all(promises); 
    }).then(results => {
        let allTxs = results.flat();
        allTxs.sort((a, b) => {
            let timeA = a.createdAt ? a.createdAt.toMillis() : 0;
            let timeB = b.createdAt ? b.createdAt.toMillis() : 0;
            return timeB - timeA;
        });
        allTxs = allTxs.slice(0, 20); 
        let html = ''; 
        if (allTxs.length === 0) html = '<tr><td colspan="5" style="text-align: center;">ไม่มีธุรกรรม</td></tr>';
        allTxs.forEach(t => { 
            const dateStr = t.createdAt ? t.createdAt.toDate().toLocaleString('th-TH') : '-'; 
            const isInc = t.type === 'inc'; 
            html += `<tr><td style="color:var(--text-secondary); font-size: 11px;">${dateStr}</td><td><span style="font-family:monospace; font-size:11px;">${t.uid.substring(0,6)}</span></td><td>${t.desc}</td><td>${isInc ? '<span style="color:var(--success)">รายรับ</span>' : '<span style="color:var(--danger)">รายจ่าย</span>'}</td><td style="font-weight:bold; color: ${isInc ? 'var(--success)' : 'var(--danger)'};">${isInc?'+':'-'}${t.amt.toLocaleString()}</td></tr>`; 
        });
        tableBody.innerHTML = html; 
        addAuditLog("👁️ โหลด Global Transactions สำเร็จ");
    }).catch(e => { 
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger);">ระบบขัดข้อง: ${e.message}</td></tr>`; 
    });
}

function clearDemoData() { showToast("ฟังก์ชันล้าง Demo Data สงวนไว้สำหรับ Super Admin", 'info'); }

function toggleAdminRole(uid, isCurAdmin) {
    const newStatus = !isCurAdmin;
    showConfirmModal("จัดการ Role", `ต้องการ${newStatus?'ตั้งเป็น':'ปลดจาก'} Admin?`, () => {
        db.collection('users').doc(uid).update({ isAdmin: newStatus }).then(() => { showToast("เปลี่ยน Role สำเร็จ", 'success'); addAuditLog(`⭐ เปลี่ยน Role UID: ${uid.substring(0,6)}`); loadAdminData(); }).catch(e => showToast("Error (เช็ค Rules)", 'error'));
    });
}

function toggleSuspendUser(uid, isCurSuspended) {
    const newStatus = !isCurSuspended;
    showConfirmModal("จัดการสถานะ", `ต้องการ${newStatus?'ระงับ (Ban)':'ปลดแบน'} บัญชีนี้?`, () => {
        db.collection('users').doc(uid).update({ isSuspended: newStatus }).then(() => { showToast(newStatus ? "แบนบัญชีสำเร็จ" : "ปลดแบนสำเร็จ", 'success'); addAuditLog(`${newStatus?'🚫 แบน':'✅ ปลดแบน'} UID: ${uid.substring(0,6)}`); loadAdminData(); });
    });
}

function adminBroadcast() {
    const text = document.getElementById('admin-announce-input').value;
    if(!text) {
        showConfirmModal("ปิดประกาศ", "ต้องการปิดแบนเนอร์ประกาศระบบใช่หรือไม่?", () => { db.collection('users').get().then(snap => { const batch = db.batch(); snap.forEach(doc => { batch.update(doc.ref, { sysAnnounce: "" }); }); batch.commit().then(() => { showToast("ปิดประกาศสำเร็จ", 'success'); addAuditLog(`ปิดประกาศระบบ`); }); }); });
        return;
    }
    showConfirmModal("ส่งประกาศ", "ประกาศนี้จะแสดงบนหน้าจอของผู้ใช้ทุกคน ยืนยันหรือไม่?", () => { db.collection('users').get().then(snap => { const batch = db.batch(); snap.forEach(doc => { batch.update(doc.ref, { sysAnnounce: text }); }); batch.commit().then(() => { showToast("กระจายประกาศสำเร็จ", 'success'); addAuditLog(`📢 ประกาศ: "${text}"`); document.getElementById('admin-announce-input').value = ''; }); }); });
}

function exportAdminUsersCSV() {
    let csvContent = "\uFEFFUID,Username,Email,Role,Status,Join_Date\n"; adminUsersData.forEach(d => { const date = d.createdAt ? d.createdAt.toDate().toLocaleDateString('th-TH') : '-'; const role = d.isAdmin ? 'Admin' : 'User'; const status = d.isSuspended ? 'Banned' : 'Active'; csvContent += `${d.uid},"${d.username||''}",${d.email||''},${role},${status},${date}\n`; });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "FinanceOS_Users.csv"; link.click();
}

// ==========================================
// Dashboard & Transactions Logic
// ==========================================
function openSettingsModal() { document.getElementById('settings-new-password').value = ''; document.getElementById('settings-modal').style.display = 'flex'; }
function closeSettingsModal() { document.getElementById('settings-modal').style.display = 'none'; }
function updateUserPassword() { const newPass = document.getElementById('settings-new-password').value; if(newPass.length < 6) return showToast("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร", 'error'); setLoading('btn-save-settings', true); auth.currentUser.updatePassword(newPass).then(() => { showToast("เปลี่ยนรหัสผ่านสำเร็จ!", 'success'); closeSettingsModal(); }).catch(err => showToast(err.message, 'error')).finally(() => setLoading('btn-save-settings', false)); }

function listenToTransactions() { const ref = db.collection('users').doc(currentUser.uid).collection('transactions').orderBy('createdAt', 'desc'); unsubscribeTxs = ref.onSnapshot(snapshot => { txs = []; snapshot.forEach(doc => { txs.push({ id: doc.id, ...doc.data() }); }); updateUI(); }); }
function toggleViewMode() { viewMode = viewMode === 'list' ? 'table' : 'list'; updateUI(); }
function openGoalModal() { document.getElementById('goal-input-amount').value = userGoalAmount; document.getElementById('goal-input-months').value = userGoalMonths; document.getElementById('goal-modal').style.display = 'flex'; }
function closeGoalModal() { document.getElementById('goal-modal').style.display = 'none'; }
function saveGoal() { const amt = parseFloat(document.getElementById('goal-input-amount').value); const months = parseInt(document.getElementById('goal-input-months').value); if(isNaN(amt) || isNaN(months) || amt <= 0 || months <= 0) return showToast("กรอกตัวเลขให้ถูกต้อง", 'error'); db.collection('users').doc(currentUser.uid).set({ goalAmount: amt, goalMonths: months }, { merge: true }).then(() => { showToast("อัปเดตเป้าหมายแล้ว", 'success'); closeGoalModal(); }); }

function addTx(type) {
    const rawDesc = document.getElementById('desc').value.trim(); const amt = parseFloat(document.getElementById('amount').value);
    if (!rawDesc || isNaN(amt) || amt <= 0) return showToast("กรุณากรอกข้อมูลให้ครบ", 'error'); setLoading(type === 'inc' ? 'btn-inc' : 'btn-exp', true);
    const autoCategories = { "อาหาร": ["ข้าว", "น้ำ", "ก๋วยเตี๋ยว", "กาแฟ"], "เดินทาง": ["น้ำมัน", "bts", "รถ", "แท็กซี่"], "เกม": ["steam", "เกม", "เติม"], "ช้อปปิ้ง": ["เสื้อ", "shopee"] };
    const hashtagMatches = rawDesc.match(/#[ก-๙a-zA-Z0-9_]+/g); const tags = hashtagMatches ? hashtagMatches.map(t => t.replace('#', '')) : []; let cleanDesc = rawDesc.replace(/#[ก-๙a-zA-Z0-9_]+\s*/g, '').trim();
    Object.keys(autoCategories).forEach(cat => { if (autoCategories[cat].some(word => cleanDesc.toLowerCase().includes(word)) && !tags.includes(cat)) tags.push(cat); });
    const primaryCat = tags.length > 0 ? tags[0] : ''; if (cleanDesc === '') cleanDesc = tags.length > 0 ? tags.join(', ') : 'ไม่มีรายละเอียด';
    db.collection('users').doc(currentUser.uid).collection('transactions').add({ desc: cleanDesc, amt: amt, type: type, cat: primaryCat, tags: tags, date: new Date().toISOString(), createdAt: firebase.firestore.FieldValue.serverTimestamp() }).then(() => { showToast("บันทึกสำเร็จ", 'success'); document.getElementById('desc').value = ''; document.getElementById('amount').value = ''; document.getElementById('desc').focus(); }).finally(() => setLoading(type === 'inc' ? 'btn-inc' : 'btn-exp', false));
}

function editTx(id) { const tx = txs.find(t => t.id === id); if(!tx) return; editingTxId = id; editingTxType = tx.type; let tagsString = ''; if (tx.tags && tx.tags.length > 0) tagsString = ' #' + tx.tags.join(' #'); else if (tx.cat) tagsString = ' #' + tx.cat; document.getElementById('desc').value = tx.desc + tagsString; document.getElementById('amount').value = tx.amt; document.getElementById('action-add-mode').style.display = 'none'; document.getElementById('action-edit-mode').style.display = 'flex'; }
function cancelEdit() { editingTxId = null; editingTxType = null; document.getElementById('desc').value = ''; document.getElementById('amount').value = ''; document.getElementById('action-add-mode').style.display = 'flex'; document.getElementById('action-edit-mode').style.display = 'none'; }
function saveEditTx() { if(!editingTxId) return; const rawDesc = document.getElementById('desc').value.trim(); const amt = parseFloat(document.getElementById('amount').value); if (!rawDesc || isNaN(amt) || amt <= 0) return showToast("กรอกข้อมูลให้ครบ", 'error'); setLoading('btn-save-edit', true); const hashtagMatches = rawDesc.match(/#[ก-๙a-zA-Z0-9_]+/g); const tags = hashtagMatches ? hashtagMatches.map(t => t.replace('#', '')) : []; const primaryCat = tags.length > 0 ? tags[0] : ''; let cleanDesc = rawDesc.replace(/#[ก-๙a-zA-Z0-9_]+\s*/g, '').trim(); if (cleanDesc === '') cleanDesc = tags.length > 0 ? tags.join(', ') : 'ไม่มีรายละเอียด'; db.collection('users').doc(currentUser.uid).collection('transactions').doc(editingTxId).update({ desc: cleanDesc, amt: amt, cat: primaryCat, tags: tags }).then(() => { showToast("แก้ไขสำเร็จ", 'success'); cancelEdit(); }).finally(() => setLoading('btn-save-edit', false)); }
function delTx(id) { showConfirmModal("ลบรายการ", "แน่ใจหรือไม่?", () => { db.collection('users').doc(currentUser.uid).collection('transactions').doc(id).delete().then(() => showToast("ลบรายการแล้ว", 'info')); }); }
function handleEnterPress(event) { if (event.key === 'Enter') { event.preventDefault(); if (editingTxId) saveEditTx(); else { event.shiftKey ? addTx('exp') : addTx('inc'); } } }
document.getElementById('amount').addEventListener('keydown', handleEnterPress); document.getElementById('desc').addEventListener('keydown', handleEnterPress);

function updateUI() {
    const monthSelect = document.getElementById('month-filter'); const currentFilter = monthSelect.value; const months = new Set();
    txs.forEach(t => { if(t.date) { const d = new Date(t.date); months.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}`); } });
    let optionsHtml = '<option value="all">ทุกเดือน</option>'; Array.from(months).sort().reverse().forEach(m => { const [yyyy, mm] = m.split('-'); const dateObj = new Date(yyyy, mm - 1); optionsHtml += `<option value="${m}" ${currentFilter === m ? 'selected' : ''}>${dateObj.toLocaleDateString('th-TH', { month: 'short', year: 'numeric' })}</option>`; });
    monthSelect.innerHTML = optionsHtml; 
    
    renderList(); 
    renderChart(); 
    renderBudgets();
    generateAIInsights(); // เรียก AI วิเคราะห์ข้อมูลทุกครั้งที่รีเฟรช[cite: 5]
}

function renderList() {
    let allTimeBalance = 0; const histList = document.getElementById('history-list'); histList.innerHTML = ''; let tableHtml = '';
    document.getElementById('history-list').style.display = viewMode === 'list' ? 'flex' : 'none'; document.getElementById('history-table-wrapper').style.display = viewMode === 'table' ? 'block' : 'none';
    const searchTerm = document.getElementById('search').value.toLowerCase(); const filterMonth = document.getElementById('month-filter').value;
    let incThisMonth = 0, expThisMonth = 0; const now = new Date(); const currMonth = now.getMonth(); const currYear = now.getFullYear(); const rate = currencyRates[currentCurrency];

    txs.forEach(t => { 
        allTimeBalance += (t.type === 'inc' ? t.amt : -t.amt); const d = new Date(t.date);
        if (d.getFullYear() === currYear && d.getMonth() === currMonth) {
            if (t.type === 'inc') incThisMonth += t.amt; else expThisMonth += t.amt;
        }
    });

    const netProfit = incThisMonth - expThisMonth; const daysPassed = Math.max(1, now.getDate()); const avgExp = expThisMonth / daysPassed;

    document.getElementById('tot-inc').innerText = '+' + (incThisMonth * rate).toLocaleString(undefined, {maximumFractionDigits: 2});
    document.getElementById('tot-exp').innerText = '-' + (expThisMonth * rate).toLocaleString(undefined, {maximumFractionDigits: 2});
    document.getElementById('tot-net').innerText = (netProfit * rate).toLocaleString(undefined, {maximumFractionDigits: 2});
    document.getElementById('avg-exp').innerText = (avgExp * rate).toLocaleString(undefined, {maximumFractionDigits: 2});

    const filteredTxs = txs.filter(t => { const matchSearch = t.desc.toLowerCase().includes(searchTerm) || (t.tags && t.tags.some(tag => tag.toLowerCase().includes(searchTerm.replace('#', '')))) || (t.cat && t.cat.toLowerCase().includes(searchTerm.replace('#', ''))); let matchMonth = true; if (filterMonth !== 'all' && t.date) { const d = new Date(t.date); matchMonth = (`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}` === filterMonth); } return matchSearch && matchMonth; });
    if (filteredTxs.length === 0) { histList.innerHTML = '<div class="empty-state">ไม่พบรายการ</div>'; tableHtml = '<tr><td colspan="6" class="empty-state">ไม่พบรายการ</td></tr>'; }

    filteredTxs.forEach(t => {
        let badgeHtml = ''; if (t.tags && t.tags.length > 0) badgeHtml = t.tags.map(tag => `<div class="category-badge">#${tag}</div>`).join(''); else if (t.cat) badgeHtml = `<div class="category-badge">#${t.cat}</div>`; 
        let dateStr = t.date ? new Date(t.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';
        const isInc = t.type === 'inc'; const displayAmt = (t.amt * rate).toLocaleString(undefined, {maximumFractionDigits: 2});
        
        const div = document.createElement('div'); div.className = 'list-item';
        div.innerHTML = `<div class="item-left"><div class="item-title">${t.desc}</div><div class="item-meta"><span class="item-date">${dateStr}</span><div class="tags-wrapper">${badgeHtml}</div></div></div><div class="item-right"><div class="item-amount ${isInc ? 'text-success' : 'text-danger'}" style="margin-right: 10px;">${isInc ? '+' : '-'}${displayAmt}</div><div class="action-icons"><button class="btn-edit" onclick="downloadSlip('${t.id}')">📥</button><button class="btn-edit" onclick="editTx('${t.id}')">✏️</button><button class="btn-del" onclick="delTx('${t.id}')">✕</button></div></div>`;
        histList.appendChild(div);
        tableHtml += `<tr><td style="color: var(--text-secondary);">${dateStr}</td><td><b>${t.desc}</b></td><td><div class="tags-wrapper">${badgeHtml}</div></td><td class="text-success" style="font-weight: 600;">${isInc ? '+' + displayAmt : '-'}</td><td class="text-danger" style="font-weight: 600;">${!isInc ? '-' + displayAmt : '-'}</td><td style="text-align: right;"><button class="btn-edit" onclick="downloadSlip('${t.id}')">📥</button><button class="btn-edit" onclick="editTx('${t.id}')">✏️</button><button class="btn-del" onclick="delTx('${t.id}')">✕</button></td></tr>`;
    });

    document.querySelector('#history-table tbody').innerHTML = tableHtml;
    document.getElementById('balance').innerText = (allTimeBalance * rate).toLocaleString(undefined, {maximumFractionDigits: 2}); 

    const GOAL_TOTAL_DAYS = userGoalMonths * 30; let progress = (allTimeBalance / userGoalAmount) * 100; progress = Math.max(0, Math.min(progress, 100)); 
    document.getElementById('goal-bar').style.width = `${progress}%`;
    document.getElementById('goal-text').innerText = allTimeBalance > 0 ? (allTimeBalance * rate).toLocaleString(undefined, {maximumFractionDigits: 2}) : 0;
    document.getElementById('goal-target-text').innerText = (userGoalAmount * rate).toLocaleString(undefined, {maximumFractionDigits: 2});
    document.getElementById('goal-timeline-badge').innerText = `กรอบเวลา ${userGoalMonths} เดือน`;

    const remainingAmt = Math.max(0, userGoalAmount - allTimeBalance); const runRateText = document.getElementById('run-rate-text');
    if (allTimeBalance >= userGoalAmount) { 
        runRateText.innerText = `🎉 ทะลุเป้าหมายแล้ว!`; runRateText.style.color = 'var(--success)'; 
    } else if (allTimeBalance < 0) {
        runRateText.innerText = `⚠️ ยอดติดลบ! เคลียร์หนี้ก่อนเก็บเงินนะ`; runRateText.style.color = 'var(--danger)'; 
    } else { 
        const weeklyRate = (remainingAmt / (GOAL_TOTAL_DAYS / 7)).toFixed(0); runRateText.innerText = `💡 ควรเก็บเพิ่ม ${(Number(weeklyRate) * rate).toLocaleString(undefined, {maximumFractionDigits: 2})} /สัปดาห์`; runRateText.style.color = 'var(--text-secondary)'; 
    }
}

function renderChart() {
    const ctx = document.getElementById('expenseChart').getContext('2d'); const isDark = document.body.getAttribute('data-theme') === 'dark'; const expenseByCat = {}; const rate = currencyRates[currentCurrency];
    const filterMonth = document.getElementById('month-filter').value;
    
    txs.filter(t => t.type === 'exp').forEach(t => { 
        let matchMonth = true; 
        if (filterMonth !== 'all' && t.date) { const d = new Date(t.date); matchMonth = (`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}` === filterMonth); }
        if (matchMonth) {
            const primaryTag = (t.tags && t.tags.length > 0) ? t.tags[0] : (t.cat ? t.cat : 'อื่นๆ'); 
            expenseByCat[`#${primaryTag}`] = (expenseByCat[`#${primaryTag}`] || 0) + (t.amt * rate); 
        }
    });
    
    if (expenseChartInstance) expenseChartInstance.destroy();
    expenseChartInstance = new Chart(ctx, { type: 'line', data: { labels: Object.keys(expenseByCat).length > 0 ? Object.keys(expenseByCat) : ['ยังไม่มีรายการ'], datasets: [{ label: `รายจ่าย (${currentCurrency})`, data: Object.values(expenseByCat).length > 0 ? Object.values(expenseByCat) : [0], borderColor: '#6366f1', backgroundColor: '#6366f133', borderWidth: 2, pointBackgroundColor: isDark ? '#111827' : '#ffffff', fill: true, tension: 0.3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: isDark ? '#374151' : '#e5e7eb', drawBorder: false }, ticks: { color: isDark ? '#9ca3af' : '#6b7280' } }, x: { grid: { display: false }, ticks: { color: isDark ? '#9ca3af' : '#6b7280' } } } } });
}

function handleFileUpload(event) { const file = event.target.files[0]; if (!file) return; if (!file.name.endsWith('.csv')) return showToast("รับเฉพาะ .csv", 'error'); setLoading('btn-import-csv', true); const reader = new FileReader(); reader.onload = function(e) { processCSVData(e.target.result); setLoading('btn-import-csv', false); }; reader.readAsText(file); }
function processCSVData(csvText) { if (!currentUser) return; const lines = csvText.split('\n').filter(line => line.trim() !== ''); if (lines.length === 0) return showToast("ไฟล์ว่างเปล่า", 'error'); const batch = db.batch(); const txsRef = db.collection('users').doc(currentUser.uid).collection('transactions'); let addedCount = 0; lines.forEach((line, index) => { if(index === 0 && (line.includes('รายละเอียด'))) return; const cols = line.split(','); if (cols.length >= 2) { const desc = cols[0].trim(); const amt = parseFloat(cols[1].trim()); const type = (cols[2] && cols[2].trim().toLowerCase() === 'รายรับ') ? 'inc' : 'exp'; const tags = cols[3] ? cols[3].trim().replace(/#/g, '').split(/\s+/) : []; let dateStr = new Date().toISOString(); if (cols[4] && cols[4].trim().match(/^\d{4}-\d{2}-\d{2}$/)) { dateStr = new Date(cols[4].trim()).toISOString(); } if (!isNaN(amt) && amt > 0 && desc !== '') { batch.set(txsRef.doc(), { desc: desc, amt: amt, type: type, cat: tags[0]||'', tags: tags, date: dateStr, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); addedCount++; } } }); if (addedCount > 0) { batch.commit().then(() => { showToast(`นำเข้า ${addedCount} รายการ`, 'success'); document.getElementById('file-upload').value = ''; }).catch(err => showToast("Error", 'error')); } else showToast("ไฟล์ไม่ถูกต้อง", 'error'); }

function exportToCSV() { 
    if (!currentUser || txs.length === 0) return showToast("ไม่มีข้อมูลให้ส่งออก", 'info'); 
    setLoading('btn-export-csv', true); 
    const rate = currencyRates[currentCurrency];
    let csvContent = "\uFEFFวันที่,รายละเอียด,จำนวนเงิน,ประเภท,แฮชแท็ก\n"; 
    txs.forEach(t => { 
        const d = t.date ? new Date(t.date).toLocaleDateString('th-TH') : ''; 
        const desc = `"${t.desc.replace(/"/g, '""')}"`; 
        const typeStr = t.type === 'inc' ? 'รายรับ' : 'รายจ่าย'; 
        csvContent += `${d},${desc},${(t.amt * rate).toFixed(2)},${typeStr},${(t.tags||[]).join(' ')}\n`; 
    }); 
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `MinimalLedger_Export_${currentCurrency}.csv`; link.click(); setTimeout(() => setLoading('btn-export-csv', false), 500); 
}

function exportToPDF() {
    if (!window.jspdf) return showToast("กำลังโหลด PDF...", "error"); showToast("กำลังสร้าง PDF...", 'info'); setLoading('btn-export-pdf', true);
    html2canvas(document.querySelector('#view-dashboard'), { scale: 2, backgroundColor: '#f9fafb' }).then(canvas => { const pdf = new window.jspdf.jsPDF('p', 'mm', 'a4'); const pdfWidth = pdf.internal.pageSize.getWidth(); const pdfHeight = (canvas.height * pdfWidth) / canvas.width; pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, pdfHeight); pdf.save(`MinimalLedger_Report_${new Date().toISOString().slice(0,10)}.pdf`); showToast("ดาวน์โหลด PDF สำเร็จ!", 'success'); }).finally(() => setLoading('btn-export-pdf', false));
}

function downloadSlip(id) {
    const tx = txs.find(t => t.id === id); if(!tx) return; showToast("กำลังสร้างสลิป...", 'info');
    const slipAmt = document.getElementById('slip-amount'); slipAmt.innerText = (tx.type === 'inc' ? '+' : '-') + (tx.amt * currencyRates[currentCurrency]).toLocaleString() + ` ${currentCurrency}`; slipAmt.style.color = tx.type === 'inc' ? '#10b981' : '#f43f5e';
    document.getElementById('slip-desc').innerText = tx.desc; document.getElementById('slip-date').innerText = new Date(tx.date).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }); document.getElementById('slip-user').innerText = currentUsername;
    html2canvas(document.getElementById('slip-card'), { scale: 3, backgroundColor: null }).then(canvas => { const link = document.createElement('a'); link.download = `Slip_${tx.id.substring(0,6)}.png`; link.href = canvas.toDataURL('image/png'); link.click(); showToast("ดาวน์โหลดสลิปสำเร็จ! 🎉", 'success'); });
}

// ==========================================
// 🤖 AI Financial Advisor Logic
// ==========================================
function generateAIInsights() {
    const container = document.getElementById('ai-insights-container');
    const filterMonth = document.getElementById('month-filter').value;
    const now = new Date();
    let targetYear = now.getFullYear();
    let targetMonth = now.getMonth();

    if (filterMonth !== 'all') {
        const [yyyy, mm] = filterMonth.split('-');
        targetYear = parseInt(yyyy); targetMonth = parseInt(mm) - 1;
    }
    
    let incTotal = 0, expTotal = 0;
    const expenseByCat = {};
    
    txs.forEach(t => {
        const d = new Date(t.date);
        if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
            if (t.type === 'inc') incTotal += t.amt;
            else {
                expTotal += t.amt;
                const cat = (t.tags && t.tags.length > 0) ? t.tags[0] : (t.cat || 'อื่นๆ');
                expenseByCat[cat] = (expenseByCat[cat] || 0) + t.amt;
            }
        }
    });

    if (incTotal === 0 && expTotal === 0) {
        container.innerHTML = '<div style="font-size: 13px; color: var(--text-secondary);">ยังไม่มีข้อมูลเพียงพอให้ AI วิเคราะห์ในเดือนนี้ ลองเพิ่มรายการดูนะ! 💡</div>';
        return;
    }

    let topCat = ''; let maxExp = 0;
    Object.keys(expenseByCat).forEach(c => {
        if(expenseByCat[c] > maxExp) { maxExp = expenseByCat[c]; topCat = c; }
    });

    let savings = incTotal - expTotal;
    let savingRate = incTotal > 0 ? (savings / incTotal) * 100 : 0;
    
    let insightsHtml = '';
    const rate = currencyRates[currentCurrency];
    
    //[cite: 5] 1. วิเคราะห์หมวดที่ใช้เงินมากที่สุด
    if (maxExp > 0) {
        let pct = ((maxExp / expTotal) * 100).toFixed(0);
        insightsHtml += `<div class="ai-insight-item warning">⚠️ คุณหมดเงินไปกับ <b>#${topCat}</b> มากที่สุด คิดเป็น <b>${pct}%</b> ของรายจ่าย (${(maxExp * rate).toLocaleString()} ${currentCurrency}) ลองลดการใช้จ่ายส่วนนี้ดูนะ</div>`;
    }
    
    //[cite: 5] 2. แนะนำการออม & ลดค่าใช้จ่าย
    if (savings < 0) {
        insightsHtml += `<div class="ai-insight-item danger">🚨 เดือนนี้รายจ่ายคุณเกินรายรับไปแล้ว! ระวังเรื่องการสร้างหนี้เพิ่มนะ ควรเบรกการช้อปปิ้งด่วนๆ</div>`;
    } else if (savingRate < 10) {
        insightsHtml += `<div class="ai-insight-item warning">💡 สัดส่วนการออมเดือนนี้ค่อนข้างต่ำ (${savingRate.toFixed(1)}%) พยายามเก็บเงินให้ได้อย่างน้อย 20% ของรายรับนะ</div>`;
    } else {
        insightsHtml += `<div class="ai-insight-item success">🎉 ยอดเยี่ยม! เดือนนี้คุณมีเงินออม ${savingRate.toFixed(1)}% ของรายรับ รักษาวินัยแบบนี้ไว้นะ</div>`;
    }

    container.innerHTML = `<div style="display: flex; flex-direction: column; gap: 0;">${insightsHtml}</div>`;
}

// ==========================================
// 💵 Budget Planner Logic (อัปเกรด: แก้ไข & ลบได้)
// ==========================================
function openBudgetModal(cat = null) { 
    if (cat) {
        // กรณีแก้ไขงบที่มีอยู่แล้ว
        document.getElementById('budget-category').value = cat;
        document.getElementById('budget-category').disabled = true; // ป้องกันการเปลี่ยนชื่อหมวด
        document.getElementById('budget-limit').value = userBudgets[cat];
    } else {
        // กรณีสร้างใหม่
        document.getElementById('budget-category').value = '';
        document.getElementById('budget-category').disabled = false;
        document.getElementById('budget-limit').value = '';
    }
    document.getElementById('budget-modal').style.display = 'flex'; 
}

function closeBudgetModal() { document.getElementById('budget-modal').style.display = 'none'; }

function saveBudget() {
    const cat = document.getElementById('budget-category').value.trim();
    const limit = parseFloat(document.getElementById('budget-limit').value);
    if (!cat || isNaN(limit) || limit <= 0) return showToast("กรุณากรอกข้อมูลให้ถูกต้อง", 'error');
    userBudgets[cat] = limit;
    db.collection('users').doc(currentUser.uid).set({ budgets: userBudgets }, { merge: true }).then(() => {
        showToast(`บันทึกงบ #${cat} สำเร็จ!`, 'success');
        closeBudgetModal();
        updateUI(); // รีเฟรชหน้าจอทั้งหมด
    }).catch(err => showToast(err.message, 'error'));
}

// ฟังก์ชันลบงบประมาณ
function deleteBudget(cat) {
    showConfirmModal("ลบงบประมาณ", `ต้องการลบการตั้งงบหมวด #${cat} ใช่หรือไม่?`, () => {
        delete userBudgets[cat];
        db.collection('users').doc(currentUser.uid).update({ 
            budgets: userBudgets // อัปเดตทับ object ใหม่ที่ไม่มีหมวดนั้นแล้ว
        }).then(() => {
            showToast(`ลบงบหมวด #${cat} แล้ว`, 'success');
            updateUI(); // รีเฟรชหน้าจอทั้งหมด
        });
    });
}

function renderBudgets() {
    const container = document.getElementById('budget-list-container');
    if (Object.keys(userBudgets).length === 0) {
        container.innerHTML = '<div class="empty-state">ยังไม่มีการตั้งงบประมาณ กดปุ่ม + เพื่อเพิ่มงบ</div>';
        return;
    }

    const currentMonthExp = {};
    const filterMonth = document.getElementById('month-filter').value;
    const now = new Date();
    let targetYear = now.getFullYear();
    let targetMonth = now.getMonth();

    if (filterMonth !== 'all') {
        const [yyyy, mm] = filterMonth.split('-');
        targetYear = parseInt(yyyy);
        targetMonth = parseInt(mm) - 1;
    }
    
    txs.filter(t => t.type === 'exp').forEach(t => {
        const d = new Date(t.date);
        if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
            const tag = (t.tags && t.tags.length > 0) ? t.tags[0] : (t.cat || 'อื่นๆ');
            currentMonthExp[tag] = (currentMonthExp[tag] || 0) + t.amt;
        }
    });

    let html = '';
    const rate = currencyRates[currentCurrency];

    Object.keys(userBudgets).forEach(cat => {
        const limit = userBudgets[cat];
        const spent = currentMonthExp[cat] || 0;
        
        const spentRate = spent * rate;
        const limitRate = limit * rate;
        
        let percent = (spent / limit) * 100;
        const displayPercent = percent;
        percent = Math.min(percent, 100); 
        
        let statusClass = 'safe';
        let alertIcon = '';
        if (percent >= 100) { statusClass = 'danger'; alertIcon = '🚨 เกินงบแล้ว!'; }
        else if (percent >= 80) { statusClass = 'warning'; alertIcon = '⚠️ ใกล้เกินงบ'; }

        html += `
        <div class="budget-item">
            <div class="budget-header">
                <span>#${cat} <span style="font-size: 11px; color: var(--danger);">${alertIcon}</span></span>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <span>${spentRate.toLocaleString(undefined, {maximumFractionDigits: 2})} / ${limitRate.toLocaleString(undefined, {maximumFractionDigits: 2})} <span class="currency">${currentCurrency}</span></span>
                    <button class="btn-icon" style="color: var(--text-secondary);" onclick="openBudgetModal('${cat}')" title="แก้ไข">✏️</button>
                    <button class="btn-icon" style="color: var(--danger);" onclick="deleteBudget('${cat}')" title="ลบ">✕</button>
                </div>
            </div>
            <div class="budget-track"><div class="budget-fill ${statusClass}" style="width: ${percent}%"></div></div>
            <div class="budget-meta">
                <span>ใช้ไปแล้ว ${displayPercent.toFixed(1)}%</span>
                <span>เหลืออีก ${(Math.max(0, limitRate - spentRate)).toLocaleString(undefined, {maximumFractionDigits: 2})} <span class="currency">${currentCurrency}</span></span>
            </div>
        </div>`;
    });
    
    container.innerHTML = html;
}