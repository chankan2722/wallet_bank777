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

// ==========================================
// 📱 PWA Magic (จำลอง Manifest ให้ติดตั้งแอปได้)
// ==========================================
const manifestContent = {
    "name": "FinanceOS Ledger",
    "short_name": "FinanceOS",
    "description": "Smart Personal Finance Management System",
    "start_url": "./",
    "display": "standalone",
    "background_color": "#ffffff",
    "theme_color": "#6366f1",
    "icons": [
        { "src": "https://cdn-icons-png.flaticon.com/512/3135/3135715.png", "sizes": "512x512", "type": "image/png" },
        { "src": "https://cdn-icons-png.flaticon.com/512/3135/3135715.png", "sizes": "192x192", "type": "image/png" }
    ]
};
const manifestBlob = new Blob([JSON.stringify(manifestContent)], {type: 'application/json'});
const manifestUrl = URL.createObjectURL(manifestBlob);
const manifestLink = document.createElement('link');
manifestLink.rel = 'manifest';
manifestLink.href = manifestUrl;
document.head.appendChild(manifestLink);

// ==========================================
// ตัวแปรส่วนกลาง (Global Variables)
// ==========================================
let currentUser = null; 
let currentUsername = ""; 
let currentUserRole = "user"; 
let txs = []; 
let unsubscribeTxs = null; 
let unsubscribeUser = null; 
let expenseChartInstance = null; 
let adminPlatformChartInstance = null;
let userGoalAmount = 20000; 
let userGoalMonths = 5; 
let editingTxId = null; 
let viewMode = 'list'; 
let confirmActionCallback = null;
let userBudgets = {}; 
let isAdminView = false; 
let isSystemMaintenance = false;
let displayLimit = 20; // ⚡ Limit สำหรับ Lazy Render

let currentCurrency = 'THB';
let currencyRates = { THB: 1, USD: 0.027, JPY: 4.3 }; 

// 💱 อัปเดตค่าเงิน Real-time
async function fetchLiveCurrency() { 
    try { 
        const res = await fetch('https://open.er-api.com/v6/latest/THB'); 
        const data = await res.json(); 
        if (data && data.rates) { 
            currencyRates.USD = data.rates.USD; 
            currencyRates.JPY = data.rates.JPY; 
        } 
    } catch (e) { 
        console.log("Currency API Error, using fallback."); 
    } 
} 
fetchLiveCurrency(); 

// ==========================================
// 🛠️ Utilities & UI Helpers
// ==========================================
function changeCurrency() { 
    currentCurrency = document.getElementById('currency-select').value; 
    document.querySelectorAll('.currency').forEach(el => el.innerText = currentCurrency); 
    updateUI(); 
}

if (localStorage.getItem('theme') === 'dark') document.body.setAttribute('data-theme', 'dark');

function toggleTheme() { 
    const isDark = document.body.getAttribute('data-theme') === 'dark'; 
    document.body.setAttribute('data-theme', isDark ? 'light' : 'dark'); 
    localStorage.setItem('theme', isDark ? 'light' : 'dark'); 
    renderChart(); 
}

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

function openPortfolioModal() { document.getElementById('portfolio-modal').style.display = 'flex'; }
function closePortfolioModal() { document.getElementById('portfolio-modal').style.display = 'none'; }

// 🛡️ ป้องกัน XSS Injection ด้วย TextContent
function sanitizeHTML(str) { 
    if(!str) return '';
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}

// ==========================================
// 🔐 Authentication System
// ==========================================
function toggleAuth(mode) { 
    document.querySelectorAll('.auth-card').forEach(el => el.style.display = 'none'); 
    document.querySelectorAll('.error-msg').forEach(el => el.style.display = 'none'); 
    document.getElementById('auth-' + mode + '-box').style.display = 'block'; 
}

function registerNewUser() { 
    const username = sanitizeHTML(document.getElementById('reg-username').value.trim()); 
    const email = document.getElementById('reg-email').value.trim(); 
    const pass = document.getElementById('reg-password').value; 
    const errDiv = document.getElementById('reg-error'); 
    
    if(!username || !email || !pass) {
        errDiv.innerText = "กรุณากรอกข้อมูลให้ครบถ้วน";
        errDiv.style.display = 'block';
        return;
    }
    
    setLoading('btn-register', true); 
    
    db.collection('users').where('username', '==', username).get()
        .then(snapshot => { 
            if(!snapshot.empty) throw new Error("ชื่อผู้ใช้งานนี้มีคนใช้แล้ว กรุณาเปลี่ยนใหม่"); 
            return auth.createUserWithEmailAndPassword(email, pass); 
        })
        .then((userCredential) => { 
            return db.collection('users').doc(userCredential.user.uid).set({ 
                username: username, 
                email: email, 
                isAdmin: false, 
                isSuspended: false, 
                isDeleted: false, 
                maintenanceMode: false, 
                createdAt: firebase.firestore.FieldValue.serverTimestamp() 
            }); 
        })
        .then(() => showToast(`ยินดีต้อนรับ ${username}`, 'success'))
        .catch(err => { errDiv.innerText = err.message; errDiv.style.display = 'block'; })
        .finally(() => setLoading('btn-register', false)); 
}

function loginWithUsername() { 
    const loginInput = sanitizeHTML(document.getElementById('login-username').value.trim()); 
    const pass = document.getElementById('login-password').value; 
    const errDiv = document.getElementById('login-error'); 
    
    if(!loginInput || !pass) {
        errDiv.innerText = "กรุณากรอกข้อมูลให้ครบถ้วน";
        errDiv.style.display = 'block';
        return;
    }
    
    setLoading('btn-login', true); 
    
    if (loginInput.includes('@')) { 
        // ล็อกอินด้วย Email
        auth.signInWithEmailAndPassword(loginInput, pass)
            .catch(err => { errDiv.innerText = "อีเมลหรือรหัสผ่านไม่ถูกต้อง"; errDiv.style.display = 'block'; })
            .finally(() => setLoading('btn-login', false)); 
    } else { 
        // ล็อกอินด้วย Username
        db.collection('users').where('username', '==', loginInput).get()
            .then(snapshot => { 
                if(snapshot.empty) throw new Error("ไม่พบชื่อผู้ใช้งานนี้ในระบบ"); 
                return auth.signInWithEmailAndPassword(snapshot.docs[0].data().email, pass); 
            })
            .catch(err => { errDiv.innerText = err.message; errDiv.style.display = 'block'; })
            .finally(() => setLoading('btn-login', false)); 
    } 
}

function resetPassword() { 
    const email = document.getElementById('reset-email').value.trim(); 
    const errDiv = document.getElementById('reset-error'); 
    if(!email) { errDiv.innerText = "กรุณากรอกอีเมล"; errDiv.style.display = 'block'; return; } 
    
    setLoading('btn-reset', true); 
    auth.sendPasswordResetEmail(email)
        .then(() => { 
            errDiv.style.display = 'none'; 
            showToast("ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว", 'info'); 
            toggleAuth('login'); 
        })
        .catch(error => { errDiv.innerText = error.message; errDiv.style.display = 'block'; })
        .finally(() => setLoading('btn-reset', false)); 
}

function logout() { 
    auth.signOut(); 
}

// ตรวจสอบสถานะการล็อกอิน
auth.onAuthStateChanged(user => {
    if (user) { 
        currentUser = user; 
        document.getElementById('login-screen').style.display = 'none'; 
        resetForm();
        
        // อัปเดตเวลาเข้าใช้งานล่าสุด
        db.collection('users').doc(user.uid).update({ 
            lastLogin: firebase.firestore.FieldValue.serverTimestamp() 
        }).catch(()=>{});
        
        listenToUserData(); 
        listenToTransactions(); 
    } else { 
        currentUser = null; currentUsername = ""; 
        document.getElementById('login-screen').style.display = 'flex'; 
        document.getElementById('app-screen').style.display = 'none'; 
        document.getElementById('maintenance-screen').style.display = 'none'; 
        txs = []; 
        if (unsubscribeTxs) unsubscribeTxs(); 
        if (unsubscribeUser) unsubscribeUser(); 
    }
});

// ==========================================
// 🛡️ Data Sync & Maintenance Check
// ==========================================
function listenToUserData() {
    unsubscribeUser = db.collection('users').doc(currentUser.uid).onSnapshot(doc => {
        if (!doc.exists) return; 
        const data = doc.data();
        
        // เช็คการโดนแบน
        if (data.isDeleted === true || data.isSuspended === true) { 
            alert("⚠️ บัญชีของคุณถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ"); 
            return logout(); 
        }
        
        currentUserRole = data.isAdmin === true ? "admin" : "user"; 
        isSystemMaintenance = data.maintenanceMode === true;
        
        // 🔒 Hardcore Maintenance: ถ้าปิดระบบ จะล้างหน้าจอของ User ทิ้งเลย ป้องกันการแฮก CSS
        if (isSystemMaintenance && currentUserRole !== 'admin') { 
            document.getElementById('login-screen').style.display = 'none'; 
            document.getElementById('app-screen').innerHTML = ''; 
            document.getElementById('maintenance-screen').style.display = 'flex'; 
            if(unsubscribeTxs) unsubscribeTxs(); 
            return; 
        } else { 
            document.getElementById('maintenance-screen').style.display = 'none'; 
        }
        
        // โหลดตั้งค่าส่วนตัว
        if (data.goalAmount) userGoalAmount = data.goalAmount; 
        if (data.goalMonths) userGoalMonths = data.goalMonths; 
        if (data.budgets) userBudgets = data.budgets; else userBudgets = {};
        
        currentUsername = data.username || "User"; 
        document.getElementById('user-display-name').innerText = currentUsername; 
        
        const viewDash = document.getElementById('view-dashboard'); 
        const viewAdmin = document.getElementById('view-admin');
        if(viewDash) viewDash.style.display = ''; 
        if(viewAdmin) viewAdmin.style.display = ''; 
        
        // ตั้งค่า UI สำหรับ Admin
        if (currentUserRole === "admin") { 
            document.getElementById('btn-admin-panel').style.display = 'inline-block'; 
            document.getElementById('role-badge').innerText = "ADMIN"; 
            document.getElementById('role-badge').style.background = "var(--danger)"; 
            
            loadAdminData(); 
            loadAuditLogs(); 
            loadTickets(); 
            
            if(!isAdminView && viewDash && viewAdmin) { 
                viewDash.classList.remove('hidden-view'); 
                viewAdmin.classList.add('hidden-view'); 
            } 
            
            const mBtn = document.getElementById('btn-toggle-maintenance'); 
            if(mBtn) { 
                if(isSystemMaintenance) { 
                    mBtn.innerText = "เปิดระบบปกติ (ON)"; 
                    mBtn.style.background = "var(--success)"; 
                } else { 
                    mBtn.innerText = "ปิดระบบฉุกเฉิน (OFF)"; 
                    mBtn.style.background = "var(--danger)"; 
                } 
            } 
        } else { 
            // ตั้งค่า UI สำหรับ User ธรรมดา
            let adminBtn = document.getElementById('btn-admin-panel'); 
            if(adminBtn) adminBtn.style.display = 'none'; 
            let roleBadge = document.getElementById('role-badge'); 
            if(roleBadge) { 
                roleBadge.innerText = "USER"; 
                roleBadge.style.background = "var(--text-primary)"; 
            } 
            isAdminView = false; 
            if(viewDash && viewAdmin) { 
                viewDash.classList.remove('hidden-view'); 
                viewAdmin.classList.add('hidden-view'); 
            } 
        }
        
        // เช็คระบบประกาศแบนเนอร์
        let announceEl = document.getElementById('sys-announcement'); 
        if (announceEl) { 
            if (data.sysAnnounce) { 
                announceEl.style.display = 'block'; 
                document.getElementById('sys-announcement-text').innerText = data.sysAnnounce; 
            } else { 
                announceEl.style.display = 'none'; 
            } 
        }
        
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
let totalSystemTxs = 0; 

function loadAdminData() { 
    db.collection('users').orderBy('createdAt', 'desc').get()
        .then(snap => { 
            adminUsersData = []; 
            let newUsersCount = 0; 
            let activeUsersCount = 0; 
            
            const now = new Date(); 
            const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)); 
            const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)); 
            
            snap.forEach(doc => { 
                const data = doc.data(); 
                if (data.isDeleted !== true) { 
                    data.uid = doc.id; 
                    adminUsersData.push(data); 
                    
                    if(data.createdAt && data.createdAt.toDate() > sevenDaysAgo) newUsersCount++; 
                    if(data.lastLogin && data.lastLogin.toDate() > oneDayAgo) activeUsersCount++; 
                } 
            }); 
            
            document.getElementById('admin-total-users').innerText = adminUsersData.length.toLocaleString(); 
            document.getElementById('admin-new-users').innerText = "+" + newUsersCount; 
            document.getElementById('admin-dau').innerText = activeUsersCount; 
            
            renderAdminUsersTable(adminUsersData); 
            loadGlobalTransactions(); 
        }); 
}

function renderAdminUsersTable(usersArray) { 
    let html = ''; 
    usersArray.forEach(d => { 
        const isAdmin = d.isAdmin === true; 
        const isSuspended = d.isSuspended === true; 
        const roleBadge = isAdmin ? '<span class="badge-pro" style="background:var(--danger)">Admin</span>' : '<span class="badge-pro" style="background:var(--success)">User</span>'; 
        const statusBadge = isSuspended ? '<span style="color:var(--danger); font-weight: bold;">🔴 ระงับ</span>' : '<span style="color:var(--success); font-weight: bold;">🟢 ปกติ</span>'; 
        const safeUsername = (d.username || '').replace(/'/g, "\\'"); 
        
        html += `<tr>
            <td><span style="font-size:11px; font-family: monospace;" title="${d.uid}">${d.uid.substring(0,6)}...</span></td>
            <td><b>${d.username||'-'}</b></td>
            <td>${d.email||'-'}</td>
            <td>${roleBadge}</td>
            <td>${statusBadge}</td>
            <td style="white-space: nowrap; text-align: right;">
                <div style="display: inline-flex; gap: 4px; justify-content: flex-end;">
                    <button class="btn-outline" style="padding: 4px 8px; font-size: 11px; color: #6366f1; border-color: #6366f1;" onclick="inspectUser('${d.uid}', '${safeUsername}')" title="เจาะลึก">👁️</button>
                    <button class="btn-outline" style="padding: 4px 8px; font-size: 11px;" onclick="toggleAdminRole('${d.uid}', ${isAdmin})">⭐</button>
                    <button class="btn-outline" style="padding: 4px 8px; font-size: 11px;" onclick="toggleSuspendUser('${d.uid}', ${isSuspended})">🚫</button>
                    <button class="btn-del" style="padding: 4px 8px; font-size: 11px; background: rgba(239, 68, 68, 0.1);" onclick="softDeleteUser('${d.uid}', '${safeUsername}')">🗑️</button>
                </div>
            </td>
        </tr>`; 
    }); 
    document.querySelector('#admin-users-table tbody').innerHTML = html; 
}

function filterAdminUsers() { 
    const term = document.getElementById('admin-search-user').value.toLowerCase(); 
    const filtered = adminUsersData.filter(u => 
        (u.username||'').toLowerCase().includes(term) || (u.email||'').toLowerCase().includes(term)
    ); 
    renderAdminUsersTable(filtered); 
}

function inspectUser(uid, username) { 
    const content = document.getElementById('inspect-content'); 
    content.innerHTML = '<div class="empty-state">ดึงข้อมูล...</div>'; 
    document.getElementById('inspect-modal').style.display = 'flex'; 
    
    db.collection('users').doc(uid).collection('transactions').get()
        .then(snap => { 
            let totalInc = 0; let totalExp = 0; let txCount = snap.size; 
            snap.forEach(doc => { 
                const d = doc.data(); 
                if(d.type === 'inc') totalInc += d.amt; else totalExp += d.amt; 
            }); 
            let net = totalInc - totalExp; 
            let health = net >= 0 ? '<span style="color:var(--success)">🟢 มั่นคง</span>' : '<span style="color:var(--danger)">🔴 เสี่ยง</span>'; 
            if(txCount === 0) health = '⚪ ไม่มีข้อมูล'; 
            
            content.innerHTML = `
                <div class="inspect-info-box">
                    <h4>สรุปยอดบัญชี</h4>
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>รายรับ:</span><strong class="text-success">+${totalInc.toLocaleString()}</strong></div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>รายจ่าย:</span><strong class="text-danger">-${totalExp.toLocaleString()}</strong></div>
                    <div style="display:flex; justify-content:space-between; margin-top:8px; padding-top:8px; border-top:1px solid var(--border);"><span>คงเหลือ:</span><strong style="font-size:16px;">${net.toLocaleString()} THB</strong></div>
                </div>
                <div class="inspect-info-box">
                    <h4>AI Health Check</h4>
                    <p style="font-size:14px; margin-bottom:8px;">${health}</p>
                    <p style="font-size:12px; color:var(--text-secondary)">บันทึกแล้ว ${txCount} รายการ</p>
                </div>`; 
                
            addAuditLog(`👁️ ส่องดูข้อมูลบัญชีผู้ใช้`); 
        }).catch(e => { content.innerHTML = `<div class="error-msg" style="display:block">${e.message}</div>`; }); 
}

function closeInspectModal() { document.getElementById('inspect-modal').style.display = 'none'; }

function addAuditLog(actionMsg) { 
    db.collection('admin_logs').add({ 
        action: actionMsg, 
        admin: currentUsername, 
        timestamp: firebase.firestore.FieldValue.serverTimestamp() 
    }).then(() => { if(isAdminView) loadAuditLogs(); }); 
}

function loadAuditLogs() { 
    const logBox = document.getElementById('admin-audit-log'); 
    db.collection('admin_logs').orderBy('timestamp', 'desc').limit(20).get()
        .then(snap => { 
            let html = ''; 
            snap.forEach(doc => { 
                const d = doc.data(); 
                const timeStr = d.timestamp ? d.timestamp.toDate().toLocaleString('th-TH') : 'Just now'; 
                html += `<div class="log-entry"><strong style="color: #6366f1;">[${timeStr}]</strong> ${d.admin}: ${d.action}</div>`; 
            }); 
            logBox.innerHTML = html || '<i>ไม่มีบันทึก</i>'; 
        }); 
}

function clearAuditLog() { 
    showConfirmModal("ล้าง Log ระบบ", "ประวัติการทำงานจะถูกลบถาวร ยืนยันหรือไม่?", () => { 
        db.collection('admin_logs').get()
            .then(snap => { 
                const batch = db.batch(); 
                snap.forEach(doc => batch.delete(doc.ref)); 
                return batch.commit(); 
            })
            .then(() => { showToast("ล้าง Log สำเร็จ", 'success'); loadAuditLogs(); }); 
    }); 
}

function toggleMaintenanceMode() { 
    const newState = !isSystemMaintenance; 
    showConfirmModal(
        newState ? "เปิดโหมดซ่อมบำรุง 🚨" : "ปิดโหมดซ่อมบำรุง ✅", 
        newState ? "ผู้ใช้ทั่วไปทั้งหมดจะถูกบังคับออกจากระบบและใช้งานไม่ได้ ยืนยันหรือไม่?" : "ผู้ใช้ทุกคนจะเข้าใช้งานได้ตามปกติ ยืนยันหรือไม่?", 
        () => { 
            showToast("กำลังดำเนินการ...", "info"); 
            db.collection('users').get()
                .then(snap => { 
                    const batch = db.batch(); 
                    snap.forEach(doc => batch.update(doc.ref, { maintenanceMode: newState })); 
                    return batch.commit(); 
                })
                .then(() => { 
                    showToast(newState ? "ปิดระบบสำเร็จ" : "เปิดระบบปกติ", "success"); 
                    addAuditLog(newState ? `🛑 สั่งเปิด Maintenance` : `✅ ปิด Maintenance`); 
                }); 
        }); 
}

// ==========================================
// 🗑️ ระบบล้างข้อมูล (System Cleanup)
// ==========================================
function softDeleteUser(uid, username) { 
    showConfirmModal("ย้ายลงถังขยะ", `ระงับการใช้งานและซ่อนบัญชีนี้จากระบบ (สามารถกู้คืนได้)`, () => { 
        db.collection('users').doc(uid).update({ 
            isDeleted: true, 
            isSuspended: true, 
            deletedAt: new Date().toISOString() 
        }).then(() => { 
            showToast("ย้ายลงถังขยะแล้ว", 'success'); 
            addAuditLog(`🗑️ Soft Delete UID: ${uid.substring(0,6)}`); 
            loadAdminData(); 
        }); 
    }); 
}

function showRecycleBin() { 
    document.getElementById('recycle-bin-modal').style.display = 'flex'; 
    loadRecycleBinData(); 
}

function closeRecycleBin() { document.getElementById('recycle-bin-modal').style.display = 'none'; }

function loadRecycleBinData() { 
    const tbody = document.querySelector('#recycle-bin-table tbody'); 
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">กำลังโหลด...</td></tr>'; 
    
    db.collection('users').where('isDeleted', '==', true).get()
        .then(snap => { 
            let html = ''; 
            if(snap.empty) { 
                html = '<tr><td colspan="4" style="text-align: center;">ไม่มีข้อมูลในถังขยะ</td></tr>'; 
            } else { 
                snap.forEach(doc => { 
                    const d = doc.data(); 
                    const safeUsername = (d.username || '').replace(/'/g, "\\'"); 
                    const date = d.deletedAt ? new Date(d.deletedAt).toLocaleDateString('th-TH') : '-'; 
                    html += `<tr>
                        <td><span style="font-size:11px; font-family: monospace;">${doc.id.substring(0,6)}...</span></td>
                        <td><b>${d.username||'-'}</b></td>
                        <td>${date}</td>
                        <td style="white-space: nowrap; text-align: right;">
                            <div style="display: inline-flex; gap: 8px; justify-content: flex-end;">
                                <button class="btn-outline" style="padding: 4px 8px; font-size: 11px; color: var(--success);" onclick="restoreUser('${doc.id}', '${safeUsername}')">♻️ กู้คืน</button> 
                                <button class="btn-del" style="padding: 4px 8px; font-size: 11px; background: rgba(239,68,68,0.1);" onclick="hardDeleteUser('${doc.id}', '${safeUsername}')">🔥 ลบถาวร</button>
                            </div>
                        </td>
                    </tr>`; 
                }); 
            } 
            tbody.innerHTML = html; 
        }); 
}

function restoreUser(uid, username) { 
    closeRecycleBin(); 
    showConfirmModal("กู้คืนบัญชี", `กู้คืนบัญชี ${username} กลับสู่ระบบ ใช่หรือไม่?`, () => { 
        db.collection('users').doc(uid).update({ 
            isDeleted: false, 
            isSuspended: false 
        }).then(() => { 
            showToast("กู้คืนสำเร็จ", "success"); 
            addAuditLog(`♻️ กู้คืนบัญชีผู้ใช้`); 
            loadRecycleBinData(); 
            loadAdminData(); 
        }); 
    }); 
}

function hardDeleteUser(uid, username) { 
    closeRecycleBin(); 
    showConfirmModal("ลบถาวร 🚨", `คำเตือน! ข้อมูลบัญชีและรายการทั้งหมดของ ${username} จะถูกลบอย่างถาวรและกู้คืนไม่ได้ ยืนยันหรือไม่?`, () => { 
        showToast("กำลังล้างข้อมูล...", 'info'); 
        db.collection('users').doc(uid).collection('transactions').get()
            .then(snap => { 
                const batch = db.batch(); 
                snap.forEach(doc => batch.delete(doc.ref)); 
                return batch.commit(); 
            })
            .then(() => { return db.collection('users').doc(uid).delete(); })
            .then(() => { 
                showToast("ลบข้อมูลถาวรสำเร็จ", "success"); 
                addAuditLog(`🔥 ลบถาวรบัญชีผู้ใช้`); 
                loadRecycleBinData(); 
            }); 
    }); 
}

function clearDemoData() { 
    showConfirmModal("ล้างข้อมูลทั้งหมด 🚨", "คำเตือน! ข้อมูลผู้ใช้และธุรกรรมทั้งหมด (ยกเว้นบัญชีของคุณเอง) จะถูกลบทิ้งอย่างถาวร เหมาะสำหรับเคลียร์ระบบ ยืนยันหรือไม่?", () => { 
        showToast("กำลังประมวลผลลบข้อมูล...", 'info'); 
        db.collection('users').get()
            .then(snap => {
                const batch = db.batch();
                let deleteCount = 0;
                snap.forEach(doc => {
                    // ป้องกันการลบบัญชีตัวเอง
                    if (doc.id !== currentUser.uid) { 
                        batch.delete(doc.ref);
                        deleteCount++;
                    }
                });
                return batch.commit().then(() => deleteCount);
            })
            .then((count) => {
                showToast(`ล้างข้อมูล ${count} บัญชี สำเร็จ`, 'success');
                addAuditLog(`🔥 ล้างฐานข้อมูลผู้ใช้ทั้งหมด (ยกเว้นบัญชีตัวเอง)`);
                loadAdminData(); 
            })
            .catch(e => showToast("เกิดข้อผิดพลาด: " + e.message, 'error'));
    }); 
}

function toggleAdminRole(uid, isCurAdmin) { 
    const newStatus = !isCurAdmin; 
    showConfirmModal("จัดการ Role", `ต้องการเปลี่ยนสิทธิ์ให้บัญชีนี้เป็น ${newStatus ? 'Admin' : 'User ธรรมดา'} หรือไม่?`, () => { 
        db.collection('users').doc(uid).update({ isAdmin: newStatus })
            .then(() => { showToast("เปลี่ยน Role สำเร็จ", 'success'); loadAdminData(); }); 
    }); 
}

function toggleSuspendUser(uid, isCurSuspended) { 
    const newStatus = !isCurSuspended; 
    showConfirmModal("จัดการสถานะ", `ต้องการ${newStatus ? 'ระงับ' : 'ปลดระงับ'}บัญชีนี้ หรือไม่?`, () => { 
        db.collection('users').doc(uid).update({ isSuspended: newStatus })
            .then(() => { showToast("ดำเนินการสำเร็จ", 'success'); loadAdminData(); }); 
    }); 
}

function adminBroadcast() { 
    const text = document.getElementById('admin-announce-input').value; 
    if(!text) { 
        showConfirmModal("ปิดประกาศ", "ต้องการปิดประกาศระบบใช่หรือไม่?", () => { 
            db.collection('users').get().then(snap => { 
                const batch = db.batch(); 
                snap.forEach(doc => batch.update(doc.ref, { sysAnnounce: "" })); 
                batch.commit().then(() => { showToast("ปิดประกาศสำเร็จ", 'success'); }); 
            }); 
        }); 
        return; 
    } 
    showConfirmModal("ส่งประกาศ", "ต้องการส่งประกาศแจ้งเตือนให้ผู้ใช้ทุกคนเห็น ใช่หรือไม่?", () => { 
        db.collection('users').get().then(snap => { 
            const batch = db.batch(); 
            snap.forEach(doc => batch.update(doc.ref, { sysAnnounce: text })); 
            batch.commit().then(() => { 
                showToast("ประกาศสำเร็จ", 'success'); 
                document.getElementById('admin-announce-input').value = ''; 
            }); 
        }); 
    }); 
}

function exportAdminUsersCSV() { 
    let csvContent = "\uFEFFUID,Username,Role,Status\n"; 
    adminUsersData.forEach(d => { 
        csvContent += `${d.uid},"${d.username||''}",${d.isAdmin?'Admin':'User'},${d.isSuspended?'Banned':'Active'}\n`; 
    }); 
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); 
    const link = document.createElement("a"); 
    link.href = URL.createObjectURL(blob); 
    link.download = "Users_Database.csv"; 
    link.click(); 
}

// ==========================================
// 📊 Global Transactions & Admin Chart
// ==========================================
function loadGlobalTransactions() { 
    const tableBody = document.querySelector('#admin-global-tx-table tbody'); 
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">กำลังโหลด...</td></tr>'; 
    
    let activeUsersForPreview = adminUsersData.slice(0, 10); 
    if(activeUsersForPreview.length === 0) { 
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">ไม่มีข้อมูลผู้ใช้งาน</td></tr>'; 
        return; 
    } 
    
    let promises = activeUsersForPreview.map(user => { 
        return db.collection('users').doc(user.uid).collection('transactions')
            .orderBy('createdAt', 'desc').limit(10).get()
            .then(txSnap => { 
                let userTxs = []; 
                txSnap.forEach(txDoc => { userTxs.push({ uid: user.uid, ...txDoc.data() }); }); 
                return userTxs; 
            }); 
    }); 
    
    Promise.all(promises).then(results => { 
        let allTxs = results.flat(); 
        totalSystemTxs = allTxs.length; 
        
        let estReads = totalSystemTxs + (adminUsersData.length * 2); 
        let readEl = document.getElementById('admin-db-reads'); 
        if(readEl) readEl.innerText = estReads > 1000 ? (estReads/1000).toFixed(1) + 'k' : estReads; 
        
        let daysData = {}; 
        for(let i=6; i>=0; i--) { 
            let d = new Date(); d.setDate(d.getDate() - i); 
            daysData[d.toISOString().split('T')[0]] = { inc: 0, exp: 0 }; 
        } 
        
        allTxs.forEach(t => { 
            if(t.date) { 
                let dStr = t.date.split('T')[0]; 
                if(daysData[dStr]) { 
                    if(t.type === 'inc') daysData[dStr].inc += t.amt; 
                    else daysData[dStr].exp += t.amt; 
                } 
            } 
        }); 
        
        const ctx = document.getElementById('adminPlatformChart').getContext('2d'); 
        const isDark = document.body.getAttribute('data-theme') === 'dark'; 
        const labels = Object.keys(daysData).map(d => new Date(d).toLocaleDateString('th-TH', {day:'numeric', month:'short'})); 
        const incData = Object.values(daysData).map(d => d.inc); 
        const expData = Object.values(daysData).map(d => d.exp); 
        
        if (adminPlatformChartInstance) adminPlatformChartInstance.destroy(); 
        adminPlatformChartInstance = new Chart(ctx, { 
            type: 'bar', 
            data: { 
                labels: labels, 
                datasets: [ 
                    { label: 'รายรับระบบ', data: incData, backgroundColor: '#10b981', borderRadius: 4 }, 
                    { label: 'รายจ่ายระบบ', data: expData, backgroundColor: '#f43f5e', borderRadius: 4 } 
                ]
            }, 
            options: { 
                responsive: true, maintainAspectRatio: false, 
                plugins: { legend: { display: false } }, 
                scales: { 
                    y: { grid: { color: isDark ? '#374151' : '#e5e7eb' }, ticks: { color: isDark ? '#9ca3af' : '#6b7280' } }, 
                    x: { grid: { display: false }, ticks: { color: isDark ? '#9ca3af' : '#6b7280' } } 
                } 
            } 
        }); 
        
        allTxs.sort((a, b) => { 
            let timeA = a.createdAt ? a.createdAt.toMillis() : 0; 
            let timeB = b.createdAt ? b.createdAt.toMillis() : 0; 
            return timeB - timeA; 
        }); 
        
        let latestTxs = allTxs.slice(0, 20); 
        let html = ''; 
        if (latestTxs.length === 0) html = '<tr><td colspan="5" style="text-align: center;">ไม่มีธุรกรรม</td></tr>'; 
        
        latestTxs.forEach(t => { 
            const isInc = t.type === 'inc'; 
            html += `<tr>
                <td style="color:var(--text-secondary); font-size: 11px;">${t.createdAt ? t.createdAt.toDate().toLocaleString('th-TH') : '-'}</td>
                <td><span style="font-family:monospace; font-size:11px;">${t.uid.substring(0,6)}</span></td>
                <td>${t.desc}</td>
                <td>${isInc ? '<span style="color:var(--success)">รายรับ</span>' : '<span style="color:var(--danger)">รายจ่าย</span>'}</td>
                <td style="font-weight:bold; color: ${isInc ? 'var(--success)' : 'var(--danger)'};">${isInc?'+':'-'}${t.amt.toLocaleString()}</td>
            </tr>`; 
        }); 
        tableBody.innerHTML = html; 
    }).catch(e => { 
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger);">เกิดข้อผิดพลาด: ${e.message}</td></tr>`; 
    }); 
}

// ==========================================
// 🎧 Helpdesk Ticket System
// ==========================================
function openTicketModal() { 
    document.getElementById('ticket-modal').style.display = 'flex'; 
    document.getElementById('ticket-msg').value = ''; 
}

function closeTicketModal() { document.getElementById('ticket-modal').style.display = 'none'; }

function submitTicket() { 
    const msg = document.getElementById('ticket-msg').value.trim(); 
    if(!msg) return showToast("กรุณาพิมพ์ข้อความก่อนส่ง", "error"); 
    setLoading('btn-submit-ticket', true); 
    
    db.collection('tickets').add({ 
        uid: currentUser.uid, 
        username: currentUsername, 
        message: sanitizeHTML(msg), 
        status: 'pending', 
        createdAt: firebase.firestore.FieldValue.serverTimestamp() 
    }).then(() => { 
        showToast("ส่งข้อความเรียบร้อย ทีมงานจะรีบตรวจสอบครับ", "success"); 
        closeTicketModal(); 
    }).finally(() => setLoading('btn-submit-ticket', false)); 
}

function loadTickets() { 
    const tbody = document.querySelector('#admin-tickets-table tbody'); 
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">กำลังโหลด...</td></tr>'; 
    
    db.collection('tickets').orderBy('createdAt', 'desc').limit(20).get()
        .then(snap => { 
            let html = ''; 
            if(snap.empty) html = '<tr><td colspan="5" style="text-align: center;">ไม่มี Ticket ใหม่</td></tr>'; 
            
            snap.forEach(doc => { 
                const d = doc.data(); 
                const timeStr = d.createdAt ? d.createdAt.toDate().toLocaleString('th-TH') : '-'; 
                const statusBadge = d.status === 'pending' ? '<span style="color:#f59e0b; font-weight:bold;">รอแก้ไข</span>' : '<span style="color:var(--success); font-weight:bold;">✅ แก้แล้ว</span>'; 
                const actionBtn = d.status === 'pending' ? `<button class="btn-outline" style="padding: 4px 8px; font-size: 11px; color: var(--success);" onclick="resolveTicket('${doc.id}')">ทำเครื่องหมาย ✅</button>` : `<button class="btn-outline" style="padding: 4px 8px; font-size: 11px; opacity: 0.5;" disabled>สำเร็จ</button>`; 
                
                html += `<tr>
                    <td style="font-size: 11px; color: var(--text-secondary);">${timeStr}</td>
                    <td>${d.username}</td>
                    <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis;">${d.message}</td>
                    <td>${statusBadge}</td>
                    <td style="text-align: right;">${actionBtn}</td>
                </tr>`; 
            }); 
            tbody.innerHTML = html; 
        }); 
}

function resolveTicket(id) { 
    db.collection('tickets').doc(id).update({ status: 'resolved' })
        .then(() => { showToast("อัปเดตสถานะเป็นแก้ปัญหาแล้ว", "success"); loadTickets(); }); 
}

// ==========================================
// ⚙️ Account Settings
// ==========================================
function openSettingsModal() { 
    document.getElementById('settings-new-password').value = ''; 
    document.getElementById('settings-modal').style.display = 'flex'; 
}

function closeSettingsModal() { document.getElementById('settings-modal').style.display = 'none'; }

function updateUserPassword() { 
    const newPass = document.getElementById('settings-new-password').value; 
    if(newPass.length < 6) return showToast("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร", 'error'); 
    
    setLoading('btn-save-settings', true); 
    auth.currentUser.updatePassword(newPass)
        .then(() => { showToast("เปลี่ยนรหัสผ่านสำเร็จ!", 'success'); closeSettingsModal(); })
        .catch(err => showToast(err.message, 'error'))
        .finally(() => setLoading('btn-save-settings', false)); 
}

// ==========================================
// 💸 Transactions Core Logic
// ==========================================
function resetForm() { 
    document.getElementById('desc').value = ''; 
    document.getElementById('amount').value = ''; 
    let d = new Date(); 
    let localDate = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0]; 
    document.getElementById('tx-date').value = localDate; 
    document.getElementById('desc').focus(); 
    displayLimit = 20; 
}

function listenToTransactions() { 
    const ref = db.collection('users').doc(currentUser.uid).collection('transactions').orderBy('date', 'desc').limit(500); 
    unsubscribeTxs = ref.onSnapshot(snapshot => { 
        txs = []; 
        snapshot.forEach(doc => { txs.push({ id: doc.id, ...doc.data() }); }); 
        updateUI(); 
    }); 
}

function toggleViewMode() { viewMode = viewMode === 'list' ? 'table' : 'list'; displayLimit = 20; updateUI(); }

function openGoalModal() { 
    document.getElementById('goal-input-amount').value = userGoalAmount; 
    document.getElementById('goal-input-months').value = userGoalMonths; 
    document.getElementById('goal-modal').style.display = 'flex'; 
}

function closeGoalModal() { document.getElementById('goal-modal').style.display = 'none'; }

function saveGoal() { 
    const amt = parseFloat(document.getElementById('goal-input-amount').value); 
    const months = parseInt(document.getElementById('goal-input-months').value); 
    if(isNaN(amt) || isNaN(months) || amt <= 0 || months <= 0) return showToast("กรุณากรอกตัวเลขให้ถูกต้อง", 'error'); 
    
    db.collection('users').doc(currentUser.uid).set({ goalAmount: amt, goalMonths: months }, { merge: true })
        .then(() => { showToast("อัปเดตเป้าหมายการเงินแล้ว", 'success'); closeGoalModal(); }); 
}

function addTx(type) { 
    const rawDesc = sanitizeHTML(document.getElementById('desc').value.trim()); 
    const amt = parseFloat(document.getElementById('amount').value); 
    const dateInput = document.getElementById('tx-date').value; 
    
    if (!rawDesc || isNaN(amt) || amt <= 0) return showToast("กรุณากรอกข้อมูลให้ครบถ้วน", 'error'); 
    setLoading(type === 'inc' ? 'btn-inc' : 'btn-exp', true); 
    
    const autoCategories = { "อาหาร": ["ข้าว", "น้ำ", "ก๋วยเตี๋ยว", "กาแฟ"], "เดินทาง": ["น้ำมัน", "bts", "รถ", "แท็กซี่"], "เกม": ["steam", "เกม", "เติม"], "ช้อปปิ้ง": ["เสื้อ", "shopee"] }; 
    const hashtagMatches = rawDesc.match(/#[ก-๙a-zA-Z0-9_]+/g); 
    const tags = hashtagMatches ? hashtagMatches.map(t => t.replace('#', '')) : []; 
    let cleanDesc = rawDesc.replace(/#[ก-๙a-zA-Z0-9_]+\s*/g, '').trim(); 
    
    Object.keys(autoCategories).forEach(cat => { 
        if (autoCategories[cat].some(word => cleanDesc.toLowerCase().includes(word)) && !tags.includes(cat)) tags.push(cat); 
    }); 
    const primaryCat = tags.length > 0 ? tags[0] : ''; 
    if (cleanDesc === '') cleanDesc = tags.length > 0 ? tags.join(', ') : 'ไม่มีรายละเอียด'; 
    
    let d = new Date(); 
    if(dateInput) { let [y,m,day] = dateInput.split('-'); d = new Date(y, m-1, day, 12, 0, 0); } 
    
    db.collection('users').doc(currentUser.uid).collection('transactions').add({ 
        desc: cleanDesc, 
        amt: amt, 
        type: type, 
        cat: primaryCat, 
        tags: tags, 
        date: d.toISOString(), 
        createdAt: firebase.firestore.FieldValue.serverTimestamp() 
    }).then(() => { 
        showToast("บันทึกรายการสำเร็จ", 'success'); 
        resetForm(); 
    }).finally(() => setLoading(type === 'inc' ? 'btn-inc' : 'btn-exp', false)); 
}

function editTx(id) { 
    const tx = txs.find(t => t.id === id); 
    if(!tx) return; 
    editingTxId = id; 
    
    let tagsString = ''; 
    if (tx.tags && tx.tags.length > 0) tagsString = ' #' + tx.tags.join(' #'); 
    else if (tx.cat) tagsString = ' #' + tx.cat; 
    
    document.getElementById('desc').value = tx.desc + tagsString; 
    document.getElementById('amount').value = tx.amt; 
    
    if (tx.date) { 
        let d = new Date(tx.date); 
        let localDate = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0]; 
        document.getElementById('tx-date').value = localDate; 
    } 
    document.getElementById('action-add-mode').style.display = 'none'; 
    document.getElementById('action-edit-mode').style.display = 'flex'; 
}

function cancelEdit() { 
    editingTxId = null; 
    resetForm(); 
    document.getElementById('action-add-mode').style.display = 'flex'; 
    document.getElementById('action-edit-mode').style.display = 'none'; 
}

function saveEditTx() { 
    if(!editingTxId) return; 
    const rawDesc = sanitizeHTML(document.getElementById('desc').value.trim()); 
    const amt = parseFloat(document.getElementById('amount').value); 
    const dateInput = document.getElementById('tx-date').value; 
    
    if (!rawDesc || isNaN(amt) || amt <= 0) return showToast("กรอกข้อมูลให้ครบถ้วน", 'error'); 
    setLoading('btn-save-edit', true); 
    
    const hashtagMatches = rawDesc.match(/#[ก-๙a-zA-Z0-9_]+/g); 
    const tags = hashtagMatches ? hashtagMatches.map(t => t.replace('#', '')) : []; 
    const primaryCat = tags.length > 0 ? tags[0] : ''; 
    let cleanDesc = rawDesc.replace(/#[ก-๙a-zA-Z0-9_]+\s*/g, '').trim(); 
    if (cleanDesc === '') cleanDesc = tags.length > 0 ? tags.join(', ') : 'ไม่มีรายละเอียด'; 
    
    let d = new Date(); 
    if(dateInput) { let [y,m,day] = dateInput.split('-'); d = new Date(y, m-1, day, 12, 0, 0); } 
    
    db.collection('users').doc(currentUser.uid).collection('transactions').doc(editingTxId).update({ 
        desc: cleanDesc, 
        amt: amt, 
        cat: primaryCat, 
        tags: tags, 
        date: d.toISOString() 
    }).then(() => { 
        showToast("บันทึกการแก้ไขสำเร็จ", 'success'); 
        cancelEdit(); 
    }).finally(() => setLoading('btn-save-edit', false)); 
}

function delTx(id) { 
    showConfirmModal("ลบรายการ", "แน่ใจหรือไม่ที่จะลบรายการนี้ทิ้ง?", () => { 
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

function loadMoreTxs() { 
    displayLimit += 20; 
    updateUI(); 
}

// 🗑️ [NEW] ฟังก์ชันลบข้อมูลทั้งหมดของผู้ใช้
function deleteAllUserTransactions() {
    showConfirmModal("ล้างประวัติการเงินทั้งหมด 🚨", "คุณกำลังจะลบ 'รายการรายรับ-รายจ่ายทั้งหมด' ของคุณ ข้อมูลที่ลบแล้วจะไม่สามารถกู้คืนได้ ยืนยันหรือไม่?", () => {
        showToast("กำลังประมวลผลลบข้อมูล...", "info");
        
        const txsRef = db.collection('users').doc(currentUser.uid).collection('transactions');
        
        txsRef.get().then(snap => {
            if(snap.empty) {
                return showToast("บัญชีของคุณไม่มีข้อมูลให้ลบครับ", "info");
            }
            
            // สร้าง Promise Array เพื่อลบทุก Document ทีละอัน
            const deletePromises = [];
            snap.forEach(doc => {
                deletePromises.push(doc.ref.delete());
            });
            
            Promise.all(deletePromises)
                .then(() => {
                    showToast("ล้างประวัติการเงินทั้งหมดเรียบร้อยแล้ว!", "success");
                    // UI จะถูกรีเฟรชเป็น 0 อัตโนมัติเพราะมี onSnapshot listener ทำงานอยู่
                })
                .catch(err => {
                    showToast("เกิดข้อผิดพลาด: " + err.message, "error");
                });
        });
    });
}

// ==========================================
// 📸 OCR Scanner with Image Compression
// ==========================================
async function handleSlipOCR(event) {
    const file = event.target.files[0];
    if(!file) return;
    
    const statusEl = document.getElementById('ocr-status');
    statusEl.style.display = 'block'; 
    statusEl.innerText = 'กำลังปรับขนาดและสแกนสลิปด้วย AI... ⏳';

    try {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await new Promise(resolve => img.onload = resolve);

        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; const MAX_HEIGHT = 800;
        let width = img.width; let height = img.height;

        if (width > height) {
            if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
            if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);

        const result = await Tesseract.recognize(compressedDataUrl, 'tha+eng');
        const text = result.data.text; 
        let amount = null;
        
        const regexKeywords = /(?:จำนวนเงิน|ยอดเงิน|amount|baht|thb)[\s:]*([0-9,]+(?:\.\d{2})?)/i;
        const matchKeyword = text.match(regexKeywords);
        
        if (matchKeyword) { 
            amount = parseFloat(matchKeyword[1].replace(/,/g, '')); 
        } else {
            const regexNumbers = /[0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})/g;
            const matches = text.match(regexNumbers);
            if (matches && matches.length > 0) { 
                const amounts = matches.map(m => parseFloat(m.replace(/,/g, ''))); 
                amount = Math.max(...amounts); 
            }
        }
        
        if (amount && !isNaN(amount)) {
            document.getElementById('amount').value = amount; 
            document.getElementById('desc').value = 'สแกนสลิปโอนเงิน #สลิป';
            statusEl.style.color = 'var(--success)'; 
            statusEl.innerText = `✅ สแกนสำเร็จ! ยอด: ${amount.toLocaleString()} ฿`;
        } else {
            statusEl.style.color = '#f59e0b'; 
            statusEl.innerText = '⚠️ หาตัวเลขไม่เจอ กรุณากรอกจำนวนเงินเอง'; 
            document.getElementById('desc').value = 'สลิปโอนเงิน #สลิป';
        }
    } catch(e) { 
        statusEl.style.color = 'var(--danger)'; 
        statusEl.innerText = '❌ สแกนไม่สำเร็จ ภาพอาจจะไม่ชัด หรือระบบขัดข้อง'; 
    }
    
    document.getElementById('slip-upload').value = '';
    setTimeout(() => { 
        statusEl.style.display = 'none'; 
        statusEl.style.color = 'var(--text-secondary)'; 
    }, 5000);
}

// ==========================================
// 🖥️ UI Rendering Functions
// ==========================================
function updateUI() {
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
    
    renderList(); 
    renderChart(); 
    renderBudgets(); 
    generateAIInsights(); 
    renderAchievements(); 
    renderCalendar(); 
}

function renderList() {
    let allTimeBalance = 0; 
    const histList = document.getElementById('history-list'); 
    histList.innerHTML = ''; 
    let tableHtml = '';
    
    document.getElementById('history-list').style.display = viewMode === 'list' ? 'flex' : 'none'; 
    document.getElementById('history-table-wrapper').style.display = viewMode === 'table' ? 'block' : 'none';
    
    const searchTerm = document.getElementById('search').value.toLowerCase(); 
    const filterMonth = document.getElementById('month-filter').value;
    
    let incThisMonth = 0, expThisMonth = 0; 
    const now = new Date(); const currMonth = now.getMonth(); const currYear = now.getFullYear(); 
    const rate = currencyRates[currentCurrency];
    
    txs.forEach(t => { 
        allTimeBalance += (t.type === 'inc' ? t.amt : -t.amt); 
        const d = new Date(t.date); 
        if (d.getFullYear() === currYear && d.getMonth() === currMonth) { 
            if (t.type === 'inc') incThisMonth += t.amt; else expThisMonth += t.amt; 
        } 
    });
    
    const netProfit = incThisMonth - expThisMonth; 
    const daysPassed = Math.max(1, now.getDate()); 
    const avgExp = expThisMonth / daysPassed;
    
    document.getElementById('tot-inc').innerText = '+' + (incThisMonth * rate).toLocaleString(undefined, {maximumFractionDigits: 2}); 
    document.getElementById('tot-exp').innerText = '-' + (expThisMonth * rate).toLocaleString(undefined, {maximumFractionDigits: 2}); 
    document.getElementById('tot-net').innerText = (netProfit * rate).toLocaleString(undefined, {maximumFractionDigits: 2}); 
    document.getElementById('avg-exp').innerText = (avgExp * rate).toLocaleString(undefined, {maximumFractionDigits: 2});
    
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
    
    const loadMoreBtn = document.getElementById('btn-load-more'); 
    if (filteredTxs.length > displayLimit) { loadMoreBtn.style.display = 'block'; } else { loadMoreBtn.style.display = 'none'; } 
    const txsToRender = filteredTxs.slice(0, displayLimit);
    
    if (txsToRender.length === 0) { 
        histList.innerHTML = '<div class="empty-state">ไม่พบรายการ</div>'; 
        tableHtml = '<tr><td colspan="6" class="empty-state">ไม่พบรายการ</td></tr>'; 
    }

    const fragment = document.createDocumentFragment();

    txsToRender.forEach(t => {
        let badgeHtml = ''; 
        if (t.tags && t.tags.length > 0) badgeHtml = t.tags.map(tag => `<div class="category-badge">#${tag}</div>`).join(''); 
        else if (t.cat) badgeHtml = `<div class="category-badge">#${t.cat}</div>`; 
        
        let dateStr = t.date && typeof t.date === 'string' ? new Date(t.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : ''; 
        const isInc = t.type === 'inc'; 
        const displayAmt = (t.amt * rate).toLocaleString(undefined, {maximumFractionDigits: 2});
        
        const div = document.createElement('div'); div.className = 'list-item';
        div.innerHTML = `
            <div class="item-left">
                <div class="item-title">${t.desc}</div>
                <div class="item-meta">
                    <span class="item-date">${dateStr}</span>
                    <div class="tags-wrapper">${badgeHtml}</div>
                </div>
            </div>
            <div class="item-right">
                <div class="item-amount ${isInc ? 'text-success' : 'text-danger'}" style="margin-right: 10px;">${isInc ? '+' : '-'}${displayAmt}</div>
                <div class="action-icons">
                    <button class="btn-icon" onclick="downloadSlip('${t.id}')" title="โหลดสลิป">📥</button>
                    <button class="btn-icon" onclick="editTx('${t.id}')" title="แก้ไข">✏️</button>
                    <button class="btn-icon text-danger" onclick="delTx('${t.id}')" title="ลบ">✕</button>
                </div>
            </div>`;
        fragment.appendChild(div);
        
        const typeStr = isInc ? '<span style="color:var(--success); font-weight:600;">รายรับ</span>' : '<span style="color:var(--danger); font-weight:600;">รายจ่าย</span>';
        const amtStr = `<span style="font-weight:bold; color: ${isInc ? 'var(--success)' : 'var(--danger)'};">${isInc ? '+' : '-'}${displayAmt}</span>`;
        tableHtml += `<tr>
            <td style="color: var(--text-secondary); font-size: 11px;">${dateStr}</td>
            <td><b>${t.desc}</b></td>
            <td><div class="tags-wrapper">${badgeHtml}</div></td>
            <td>${typeStr}</td>
            <td>${amtStr}</td>
            <td style="text-align: right;">
                <button class="btn-icon" onclick="downloadSlip('${t.id}')" title="โหลดสลิป">📥</button>
                <button class="btn-icon" onclick="editTx('${t.id}')" title="แก้ไข">✏️</button>
                <button class="btn-icon text-danger" onclick="delTx('${t.id}')" title="ลบ">✕</button>
            </td>
        </tr>`;
    });
    
    histList.appendChild(fragment);
    document.querySelector('#history-table tbody').innerHTML = tableHtml; 
    
    document.getElementById('balance').innerText = (allTimeBalance * rate).toLocaleString(undefined, {maximumFractionDigits: 2}); 
    const GOAL_TOTAL_DAYS = userGoalMonths * 30; 
    let progress = (allTimeBalance / userGoalAmount) * 100; progress = Math.max(0, Math.min(progress, 100)); 
    document.getElementById('goal-bar').style.width = `${progress}%`; 
    document.getElementById('goal-text').innerText = allTimeBalance > 0 ? (allTimeBalance * rate).toLocaleString(undefined, {maximumFractionDigits: 2}) : 0; 
    document.getElementById('goal-target-text').innerText = (userGoalAmount * rate).toLocaleString(undefined, {maximumFractionDigits: 2}); 
    document.getElementById('goal-timeline-badge').innerText = `กรอบเวลา ${userGoalMonths} เดือน`;
    
    const remainingAmt = Math.max(0, userGoalAmount - allTimeBalance); 
    const runRateText = document.getElementById('run-rate-text'); 
    if (allTimeBalance >= userGoalAmount) { 
        runRateText.innerText = `🎉 ทะลุเป้าหมายแล้ว!`; 
        runRateText.style.color = 'var(--success)'; 
    } else if (allTimeBalance < 0) { 
        runRateText.innerText = `⚠️ ยอดติดลบ!`; 
        runRateText.style.color = 'var(--danger)'; 
    } else { 
        const weeklyRate = (remainingAmt / (GOAL_TOTAL_DAYS / 7)).toFixed(0); 
        runRateText.innerText = `💡 ควรเก็บเพิ่ม ${(Number(weeklyRate) * rate).toLocaleString(undefined, {maximumFractionDigits: 2})} /สัปดาห์`; 
        runRateText.style.color = 'var(--text-secondary)'; 
    }
}

function renderChart() { 
    const ctx = document.getElementById('expenseChart').getContext('2d'); 
    const isDark = document.body.getAttribute('data-theme') === 'dark'; 
    const expenseByCat = {}; const rate = currencyRates[currentCurrency]; 
    const filterMonth = document.getElementById('month-filter').value; 
    
    txs.filter(t => t.type === 'exp').forEach(t => { 
        let matchMonth = true; 
        if (filterMonth !== 'all' && t.date) { 
            const d = new Date(t.date); 
            matchMonth = (`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}` === filterMonth); 
        } 
        if (matchMonth) { 
            const primaryTag = (t.tags && t.tags.length > 0) ? t.tags[0] : (t.cat ? t.cat : 'อื่นๆ'); 
            expenseByCat[`#${primaryTag}`] = (expenseByCat[`#${primaryTag}`] || 0) + (t.amt * rate); 
        } 
    }); 
    
    if (expenseChartInstance) expenseChartInstance.destroy(); 
    expenseChartInstance = new Chart(ctx, { 
        type: 'doughnut', 
        data: { 
            labels: Object.keys(expenseByCat).length > 0 ? Object.keys(expenseByCat) : ['ยังไม่มีรายการ'], 
            datasets: [{ 
                data: Object.values(expenseByCat).length > 0 ? Object.values(expenseByCat) : [1], 
                backgroundColor: ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6'], 
                borderWidth: 0, 
                hoverOffset: 4 
            }] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { legend: { position: 'right', labels: { color: isDark ? '#9ca3af' : '#4b5563', usePointStyle: true, padding: 20 } } }, 
            cutout: '70%' 
        } 
    }); 
}

// ==========================================
// 📥 Data Management (CSV & PDF)
// ==========================================
function handleCSVUpload(event) { 
    const file = event.target.files[0]; 
    if (!file) return; 
    if (!file.name.endsWith('.csv')) return showToast("รับเฉพาะไฟล์ .csv", 'error'); 
    
    setLoading('btn-import-csv', true); 
    const reader = new FileReader(); 
    reader.onload = function(e) { processCSVData(e.target.result); setLoading('btn-import-csv', false); }; 
    reader.readAsText(file); 
}

function processCSVData(csvText) { 
    if (!currentUser) return; 
    const lines = csvText.split('\n').filter(line => line.trim() !== ''); 
    if (lines.length === 0) return showToast("ไฟล์ว่างเปล่า", 'error'); 
    
    const batch = db.batch(); 
    const txsRef = db.collection('users').doc(currentUser.uid).collection('transactions'); 
    let addedCount = 0; let skipCount = 0; let errorCount = 0;
    
    lines.forEach((line, index) => { 
        if(index === 0 && (line.includes('รายละเอียด') || line.includes('วันที่'))) return; 
        const cols = line.split(','); 
        
        // เช็คว่ามีคอลัมน์ครบอย่างน้อย 4 ช่อง
        if (cols.length >= 4) { 
            // ลำดับคอลัมน์: วันที่(0), รายละเอียด(1), จำนวนเงิน(2), ประเภท(3), แฮชแท็ก(4)
            
            // 1. ดึงวันที่
            let dateStr = new Date().toISOString(); 
            if (cols[0] && cols[0].trim().match(/^\d{4}-\d{2}-\d{2}$/)) { 
                dateStr = new Date(cols[0].trim()).toISOString(); 
            } 
            
            // 2. ดึงรายละเอียด และ จำนวนเงิน
            const desc = cols[1] ? cols[1].trim() : ''; 
            const amt = parseFloat(cols[2] ? cols[2].trim() : '0'); 
            
            // 3. ดึงประเภท
            const typeRaw = cols[3] ? cols[3].trim().toLowerCase() : ''; 
            let type = 'unknown'; 
            if (['รายรับ', 'income', 'inc'].includes(typeRaw)) type = 'inc'; 
            else if (['รายจ่าย', 'expense', 'exp'].includes(typeRaw)) type = 'exp';
            
            // 4. ดึงแฮชแท็ก
            const tags = cols[4] ? cols[4].trim().replace(/#/g, '').split(/\s+/) : []; 
            
            // ตรวจสอบความถูกต้องก่อนบันทึก
            if (type !== 'unknown' && !isNaN(amt) && amt > 0 && desc !== '') { 
                const isDuplicate = txs.some(ex => ex.desc === desc && ex.amt === amt && ex.date && typeof ex.date === 'string' && ex.date.substring(0,10) === dateStr.substring(0,10));
                
                if(!isDuplicate) { 
                    batch.set(txsRef.doc(), { 
                        desc: desc, 
                        amt: amt, 
                        type: type, 
                        cat: tags[0] || '', 
                        tags: tags, 
                        date: dateStr, 
                        createdAt: firebase.firestore.FieldValue.serverTimestamp() 
                    }); 
                    addedCount++; 
                } else { skipCount++; }
            } else { errorCount++; }
        } else {
            errorCount++;
        }
    }); 
    
    if (addedCount > 0) { 
        batch.commit().then(() => { 
            showToast(`นำเข้าใหม่ ${addedCount} รายการ (ซ้ำ ${skipCount}, ผิดรูปแบบ ${errorCount})`, 'success'); 
            document.getElementById('file-upload-csv').value = ''; 
        }).catch(err => showToast("เกิดข้อผิดพลาดในการนำเข้าข้อมูล", 'error')); 
    } else if (skipCount > 0 || errorCount > 0) { 
        showToast(`ข้อมูลซ้ำ ${skipCount} รายการ, ผิดรูปแบบ ${errorCount} รายการ`, 'warning'); 
        document.getElementById('file-upload-csv').value = ''; 
    } else {
        showToast("ไฟล์รูปแบบไม่ถูกต้อง", 'error'); 
        document.getElementById('file-upload-csv').value = ''; 
    }
}

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
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); 
    const link = document.createElement("a"); 
    link.href = URL.createObjectURL(blob); 
    link.download = `MinimalLedger_Export.csv`; 
    link.click(); 
    setTimeout(() => setLoading('btn-export-csv', false), 500); 
}

function exportToPDF() { 
    if (!window.jspdf) return showToast("กำลังโหลดไลบรารี PDF...", "error"); 
    showToast("กำลังสร้างรายงาน PDF...", 'info'); 
    setLoading('btn-export-pdf', true); 
    
    html2canvas(document.querySelector('#view-dashboard'), { scale: 2, backgroundColor: '#f9fafb' })
        .then(canvas => { 
            const pdf = new window.jspdf.jsPDF('p', 'mm', 'a4'); 
            const pdfWidth = pdf.internal.pageSize.getWidth(); 
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width; 
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, pdfHeight); 
            pdf.save(`MinimalLedger_Report.pdf`); 
            showToast("ดาวน์โหลดรายงาน PDF สำเร็จ!", 'success'); 
        })
        .finally(() => setLoading('btn-export-pdf', false)); 
}

function downloadSlip(id) { 
    const tx = txs.find(t => t.id === id); 
    if(!tx) return; 
    showToast("กำลังสร้าง E-Slip...", 'info'); 
    
    const slipAmt = document.getElementById('slip-amount'); 
    slipAmt.innerText = (tx.type === 'inc' ? '+' : '-') + (tx.amt * currencyRates[currentCurrency]).toLocaleString() + ` ${currentCurrency}`; 
    slipAmt.style.color = tx.type === 'inc' ? '#10b981' : '#f43f5e'; 
    document.getElementById('slip-desc').innerText = tx.desc; 
    document.getElementById('slip-date').innerText = tx.date && typeof tx.date === 'string' ? new Date(tx.date).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-'; 
    document.getElementById('slip-user').innerText = currentUsername; 
    
    html2canvas(document.getElementById('slip-card'), { scale: 3, backgroundColor: null })
        .then(canvas => { 
            const link = document.createElement('a'); 
            link.download = `Slip_${tx.id.substring(0,6)}.png`; 
            link.href = canvas.toDataURL('image/png'); 
            link.click(); 
            showToast("ดาวน์โหลดสลิปสำเร็จ! 🎉", 'success'); 
        }); 
}

// ==========================================
// 🤖 AI Financial Advisor
// ==========================================
function generateAIInsights() { 
    const container = document.getElementById('ai-insights-container'); 
    const filterMonth = document.getElementById('month-filter').value; 
    const now = new Date(); 
    let targetYear = now.getFullYear(); 
    let targetMonth = now.getMonth(); 
    
    if (filterMonth !== 'all') { 
        const [yyyy, mm] = filterMonth.split('-'); 
        targetYear = parseInt(yyyy); 
        targetMonth = parseInt(mm) - 1; 
    } 
    
    let incTotal = 0, expTotal = 0; 
    const expenseByCat = {}; 
    const daysOfWeekExp = {0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0}; 
    
    txs.forEach(t => { 
        if(t.date && typeof t.date === 'string') { 
            const d = new Date(t.date); 
            if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) { 
                if (t.type === 'inc') incTotal += t.amt; 
                else { 
                    expTotal += t.amt; 
                    const cat = (t.tags && t.tags.length > 0) ? t.tags[0] : (t.cat || 'อื่นๆ'); 
                    expenseByCat[cat] = (expenseByCat[cat] || 0) + t.amt; 
                    daysOfWeekExp[d.getDay()] += t.amt; 
                } 
            } 
        } 
    }); 
    
    if (incTotal === 0 && expTotal === 0) { 
        container.innerHTML = '<div style="font-size: 13px; color: var(--text-secondary); text-align: center; padding: 20px;">ยังไม่มีข้อมูลวิเคราะห์ในเดือนนี้ ลองบันทึกรายการดูนะ! 💡</div>'; 
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
    
    if (maxExp > 0) { 
        let pct = ((maxExp / expTotal) * 100).toFixed(0); 
        insightsHtml += `<div class="ai-insight-item warning">⚠️ คุณหมดเงินไปกับ <b>#${topCat}</b> มากที่สุด คิดเป็น <b>${pct}%</b> ของรายจ่าย (${(maxExp * rate).toLocaleString(undefined, {maximumFractionDigits:0})} ${currentCurrency})</div>`; 
    } 
    if (savings < 0) { 
        insightsHtml += `<div class="ai-insight-item danger">🚨 เดือนนี้รายจ่ายคุณเกินรายรับไปแล้ว! ระวังเรื่องการสร้างหนี้เพิ่ม ควรเบรกการช้อปปิ้งด่วนๆ</div>`; 
    } else if (savingRate < 10) { 
        insightsHtml += `<div class="ai-insight-item warning">💡 สัดส่วนการออมเดือนนี้ค่อนข้างต่ำ (${savingRate.toFixed(1)}%) พยายามเก็บเงินให้ได้อย่างน้อย 20% ของรายรับนะ</div>`; 
    } else { 
        insightsHtml += `<div class="ai-insight-item success">🎉 ยอดเยี่ยม! เดือนนี้คุณมีเงินออม ${savingRate.toFixed(1)}% ของรายรับ รักษาวินัยแบบนี้ไว้นะ</div>`; 
    } 
    
    const dayNames = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"]; 
    let maxDayIdx = 0; let maxDayAmt = 0; 
    for(let i=0; i<7; i++) { 
        if(daysOfWeekExp[i] > maxDayAmt) { maxDayAmt = daysOfWeekExp[i]; maxDayIdx = i; } 
    } 
    
    let forecastHtml = ''; 
    let isCurrentMonth = (targetYear === now.getFullYear() && targetMonth === now.getMonth()); 
    
    if (isCurrentMonth && expTotal > 0) { 
        forecastHtml += `<h4 style="margin: 16px 0 8px; font-size: 13px; color: var(--text-secondary); text-transform: uppercase;">🔮 AI พยากรณ์ล่วงหน้า</h4>`; 
        const currentDay = Math.max(1, now.getDate()); 
        const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate(); 
        const remainingDays = daysInMonth - currentDay; 
        const avgDailyExp = expTotal / currentDay; 
        const projectedExp = expTotal + (avgDailyExp * remainingDays); 
        const projectedBalance = incTotal - projectedExp; 
        
        if (projectedBalance < 0) { 
            let daysLeft = savings > 0 ? Math.floor(savings / avgDailyExp) : 0; 
            forecastHtml += `<div class="ai-insight-item danger">💸 <b>ระวังเงินหมด!</b> จากสถิติคุณใช้เงินวันละ ${(avgDailyExp*rate).toLocaleString(undefined, {maximumFractionDigits:0})} <b>สิ้นเดือนนี้อาจติดลบ ${(Math.abs(projectedBalance)*rate).toLocaleString(undefined, {maximumFractionDigits:0})}</b> ${daysLeft > 0 ? `(จะหมดในอีก ${daysLeft} วัน)` : ''}</div>`; 
        } else { 
            forecastHtml += `<div class="ai-insight-item info">📈 <b>คาดการณ์สิ้นเดือน:</b> หากคุณใช้เงินเรทนี้ต่อไป จะมีเงินเหลือเก็บประมาณ <b>${(projectedBalance*rate).toLocaleString(undefined, {maximumFractionDigits:0})} ${currentCurrency}</b></div>`; 
        } 
    } else if (!isCurrentMonth && expTotal > 0) { 
        forecastHtml += `<h4 style="margin: 16px 0 8px; font-size: 13px; color: var(--text-secondary); text-transform: uppercase;">📊 AI วิเคราะห์พฤติกรรม</h4>`; 
    } 
    
    if (maxDayAmt > 0) { 
        forecastHtml += `<div class="ai-insight-item purple">📅 คุณมักจะเปย์หนักที่สุดใน <b>วัน${dayNames[maxDayIdx]}</b> (รวม ${(maxDayAmt*rate).toLocaleString(undefined, {maximumFractionDigits:0})} ${currentCurrency}) ลองวางแผนงบล่วงหน้าดูนะครับ</div>`; 
    } 
    container.innerHTML = `<div style="display: flex; flex-direction: column; gap: 0;">${insightsHtml}${forecastHtml}</div>`; 
}

// ==========================================
// 💵 Budget Planner
// ==========================================
function openBudgetModal(cat = null) { 
    if (cat) { 
        document.getElementById('budget-category').value = cat; 
        document.getElementById('budget-category').disabled = true; 
        document.getElementById('budget-limit').value = userBudgets[cat]; 
    } else { 
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
    db.collection('users').doc(currentUser.uid).set({ budgets: userBudgets }, { merge: true })
        .then(() => { showToast(`บันทึกงบ #${cat} สำเร็จ!`, 'success'); closeBudgetModal(); updateUI(); })
        .catch(err => showToast(err.message, 'error')); 
}

function deleteBudget(cat) { 
    showConfirmModal("ลบงบประมาณ", `ต้องการลบการตั้งงบหมวด #${cat} ใช่หรือไม่?`, () => { 
        delete userBudgets[cat]; 
        db.collection('users').doc(currentUser.uid).update({ budgets: userBudgets })
            .then(() => { showToast(`ลบงบหมวด #${cat} แล้ว`, 'success'); updateUI(); }); 
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
        if(t.date && typeof t.date === 'string') { 
            const d = new Date(t.date); 
            if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) { 
                const tag = (t.tags && t.tags.length > 0) ? t.tags[0] : (t.cat || 'อื่นๆ'); 
                currentMonthExp[tag] = (currentMonthExp[tag] || 0) + t.amt; 
            } 
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
        
        let statusClass = 'safe'; let alertIcon = ''; 
        if (percent >= 100) { statusClass = 'danger'; alertIcon = '🚨 เกินงบแล้ว!'; } 
        else if (percent >= 80) { statusClass = 'warning'; alertIcon = '⚠️ ใกล้เกินงบ'; } 
        
        html += `<div class="budget-item">
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

// ==========================================
// 🏆 Achievement System Logic
// ==========================================
function renderAchievements() { 
    const container = document.getElementById('achievement-container'); 
    if(!container) return; 
    
    let exp = txs.length * 50; 
    let level = Math.floor(exp / 500) + 1; 
    let currentLevelExp = exp % 500; 
    let progress = (currentLevelExp / 500) * 100; 
    
    document.getElementById('user-level').innerText = level; 
    document.getElementById('user-exp-text').innerText = `${currentLevelExp} / 500 EXP`; 
    document.getElementById('user-exp-bar').style.width = `${progress}%`; 
    
    let allTimeBalance = 0; let expThisMonth = 0; const now = new Date(); 
    
    txs.forEach(t => { 
        allTimeBalance += (t.type === 'inc' ? t.amt : -t.amt); 
        if(t.date && typeof t.date === 'string') { 
            let d = new Date(t.date); 
            if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && t.type === 'exp') { 
                expThisMonth += t.amt; 
            } 
        } 
    }); 
    
    const badges = [ 
        { id: 'b1', icon: '🌱', name: 'เริ่มต้นก้าวแรก', desc: 'บันทึกรายการแรกของคุณ', unlocked: txs.length >= 1 }, 
        { id: 'b2', icon: '💰', name: 'เศรษฐีหน้าใหม่', desc: 'มีเงินเก็บทะลุ 10,000', unlocked: allTimeBalance >= 10000 }, 
        { id: 'b3', icon: '🎯', name: 'ผู้พิชิตเป้าหมาย', desc: 'เก็บเงินถึงเป้าหมายที่ตั้งไว้', unlocked: allTimeBalance >= userGoalAmount && userGoalAmount > 0 }, 
        { id: 'b4', icon: '🚨', name: 'นักเปย์ตัวยง', desc: 'ใช้จ่ายเดือนนี้เกิน 5,000', unlocked: expThisMonth >= 5000 }, 
        { id: 'b5', icon: '🔥', name: 'นักจดตัวยง', desc: 'บันทึกครบ 50 รายการ', unlocked: txs.length >= 50 } 
    ]; 
    
    let html = ''; 
    badges.forEach(b => { 
        let lockedClass = b.unlocked ? '' : 'locked'; 
        html += `<div class="badge-item ${lockedClass}" title="${b.desc}">
            <div class="badge-icon">${b.icon}</div>
            <div class="badge-name">${b.name}</div>
        </div>`; 
    }); 
    container.innerHTML = html; 
}

// ==========================================
// 📅 Calendar View Logic
// ==========================================
function renderCalendar() { 
    const container = document.getElementById('calendar-grid'); 
    if(!container) return; 
    
    const filterMonth = document.getElementById('month-filter').value; 
    const now = new Date(); 
    let targetYear = now.getFullYear(); let targetMonth = now.getMonth(); 
    
    if (filterMonth !== 'all') { 
        const [yyyy, mm] = filterMonth.split('-'); 
        targetYear = parseInt(yyyy); 
        targetMonth = parseInt(mm) - 1; 
    } 
    
    let dailyData = {}; 
    txs.forEach(t => { 
        if(t.date && typeof t.date === 'string') { 
            let d = new Date(t.date); 
            if(d.getFullYear() === targetYear && d.getMonth() === targetMonth) { 
                let day = d.getDate(); 
                if(!dailyData[day]) dailyData[day] = { inc: 0, exp: 0 }; 
                if(t.type === 'inc') dailyData[day].inc += t.amt; else dailyData[day].exp += t.amt; 
            } 
        } 
    }); 
    
    const firstDay = new Date(targetYear, targetMonth, 1).getDay(); 
    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate(); 
    
    let html = ''; 
    const dayNames = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']; 
    dayNames.forEach(d => { html += `<div class="cal-header">${d}</div>`; }); 
    
    for(let i=0; i<firstDay; i++) { html += `<div class="cal-cell empty"></div>`; } 
    
    const rate = currencyRates[currentCurrency]; 
    for(let i=1; i<=daysInMonth; i++) { 
        let dData = dailyData[i] || {inc:0, exp:0}; 
        let incHtml = dData.inc > 0 ? `<div class="cal-val text-success">+${(dData.inc * rate).toLocaleString()}</div>` : ''; 
        let expHtml = dData.exp > 0 ? `<div class="cal-val text-danger">-${(dData.exp * rate).toLocaleString()}</div>` : ''; 
        
        let formattedMonth = String(targetMonth + 1).padStart(2, '0'); 
        let formattedDay = String(i).padStart(2, '0'); 
        let fullDateStr = `${targetYear}-${formattedMonth}-${formattedDay}`; 
        
        let todayClass = (i === now.getDate() && targetMonth === now.getMonth() && targetYear === now.getFullYear()) ? 'today' : ''; 
        html += `<div class="cal-cell ${todayClass}" onclick="selectDateForTx('${fullDateStr}')">
            <div class="cal-date">${i}</div>
            <div class="cal-data-zone">${incHtml}${expHtml}</div>
        </div>`; 
    } 
    container.innerHTML = html; 
}

function selectDateForTx(dateStr) { 
    document.getElementById('tx-date').value = dateStr; 
    document.getElementById('desc').focus(); 
    window.scrollTo({ top: 0, behavior: 'smooth' }); 
    showToast(`เลือกวันที่ ${dateStr} แล้ว กรอกข้อมูลได้เลย!`, "info"); 
}