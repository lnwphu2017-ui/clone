// URL หลักของ API สำหรับคุยกับ Backend
const BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:8000/api' : '/api';
let currentChatId = null;
let abortController = null;
let currentUserUid = null;
let currentUserPhoto = '';

// ===== ตัวแปรสำหรับจัดการ API Key และ Model (เก็บใน localStorage เหมือน st.session_state) =====
let apiKey = localStorage.getItem('openrouter_api_key') || '';
let selectedModel = localStorage.getItem('selected_model') || 'google/gemini-2.0-flash-001';

// อ้างอิง Element หลัก
const chatListEl = document.getElementById('history-list');
const chatContainer = document.getElementById('chat-container');
const messageInput = document.getElementById('message-input');
const actionBtn = document.getElementById('action-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const searchInput = document.getElementById('search-chat');
const welcomeScreen = document.getElementById('welcome-screen');
const deleteModal = document.getElementById('delete-modal');
const deleteChatTitle = document.getElementById('delete-chat-title');
const confirmDeleteBtn = document.getElementById('confirm-delete');
const cancelDeleteBtn = document.getElementById('cancel-delete');
const fileInput = document.getElementById('file-input');
const filePreviewContainer = document.getElementById('file-preview-container');
const attachBtn = document.getElementById('attach-btn');
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const mainSidebarToggle = document.getElementById('main-sidebar-toggle');
const newChatBtnPersistent = document.getElementById('new-chat-btn-persistent');

let attachedFiles = [];

// อ้างอิง Element สำหรับ API Key และ Model
const apiKeyScreen = document.getElementById('api-key-screen');
const apiKeyInput = document.getElementById('api-key-input');
const saveApiKeyBtn = document.getElementById('save-api-key-btn');
const toggleKeyVisibility = document.getElementById('toggle-key-visibility');
const appContainer = document.getElementById('app-container');
const modelSelect = document.getElementById('model-select');
const changeKeyBtn = document.getElementById('change-key-btn');

let chatIdToDelete = null;
let allChats = [];
let eventListenersSetup = false; // ป้องกันการตั้ง Event ซ้ำ

window.initApp = async function () {
    await init();
};

// ฟังก์ชันเริ่มต้นการทำงาน
async function init() {
    setupApiKeyScreen();
    setupLoginScreen();

    // จัดการผลลัพธ์หลังจาก Redirect มาจาก Google
    try {
        const result = await window.getRedirectResult(window.firebaseAuth);
        if (result && result.user) {
            console.log("🔥 Redirect result found:", result.user.email);
            // บังคับให้ข้ามหน้า Login ทันที
            currentUserUid = result.user.email;
        }
    } catch (error) {
        console.error("❌ Redirect Result Error:", error);
        alert("เกิดปัญหาในการรับข้อมูลจาก Google: " + error.message + "\n(กรุณาเช็คการตั้งค่า Authorized Domain ใน Firebase/Google Cloud ครับ)");
    }

    // ดักจับสถานะล็อกอินผ่าน Firebase
    window.onAuthStateChanged(window.firebaseAuth, (user) => {
        console.log("🎯 Auth State Changed:", user ? user.email : "Logged Out");
        if (currentUserUid === "guest") return;

        if (user) {
            currentUserUid = user.email;
            currentUserPhoto = user.photoURL || '';
            document.getElementById('login-screen').style.display = 'none';

            const userProfile = document.getElementById('user-profile');
            if (userProfile) {
                userProfile.innerHTML = `<img src="${user.photoURL || ''}" style="width:24px;height:24px;border-radius:50%;" onerror="this.style.display='none'"> <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${user.email}</span>`;
            }

            // ตัดสินใจว่าจะไปหน้าไหน
            if (apiKey) {
                showApp();
            } else {
                showApiKeyScreen();
            }
        } else if (!user) {
            currentUserUid = null;
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('api-key-screen').style.display = 'none';
            document.getElementById('app-container').style.display = 'none';
        }
    });

    // ปุ่ม Logout ทั้งหมดในแอป
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.onclick = handleLogout;

    const logoutKeyBtn = document.getElementById('logout-from-key-btn');
    if (logoutKeyBtn) logoutKeyBtn.onclick = handleLogout;

    // ระบบหุ้ม Sidebar (Collapse)
    setupSidebarToggle();
}

// ฟังก์ชันควบคุมการหด-ขยาย Sidebar
function setupSidebarToggle() {
    // โหลดสถานะล่าสุดจาก localStorage
    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
    }

    // ฟังก์ชันช่วยสลับสถานะ
    const toggleSidebar = () => {
        const isCurrentlyCollapsed = sidebar.classList.toggle('collapsed');
        document.body.classList.toggle('sidebar-collapsed', isCurrentlyCollapsed);
        localStorage.setItem('sidebar_collapsed', isCurrentlyCollapsed);
    };

    if (mainSidebarToggle) mainSidebarToggle.onclick = toggleSidebar;
    if (toggleSidebarBtn) toggleSidebarBtn.onclick = toggleSidebar;

    // เชื่อมต่อปุ่ม New Chat ตัวใหม่ (ที่อยู่ข้างนอกถาวร)
    if (newChatBtnPersistent) {
        newChatBtnPersistent.onclick = () => {
            currentChatId = null;
            updateLayoutState(true);
            clearMessages();
            // ถ้าเป็นมือถือ หรือหน้าจอเล็ก อาจจะอยากให้หุบ Sidebar อัตโนมัติ (ใส่เพิ่มได้ถ้าต้องการ)
        };
    }
}

// ===== จัดการหน้าจอ Login =====
function setupLoginScreen() {
    let isSignUpMode = false;

    // อ้างอิง Element ใหม่จากดีไซน์ SiamGPT
    const authTitle = document.getElementById('auth-title');
    const nameGroup = document.getElementById('name-group');
    const authMainBtn = document.getElementById('auth-main-btn');
    const toggleAuthMode = document.getElementById('toggle-auth-mode');
    const toggleMsg = document.getElementById('toggle-msg');
    const loginEmail = document.getElementById('login-email');
    const loginPassword = document.getElementById('login-password');
    const toggleLoginPassword = document.getElementById('toggle-login-password');
    const guestLoginBtn = document.getElementById('guest-login-btn');
    const googleLoginBtn = document.getElementById('login-google-btn');
    const passwordHint = document.getElementById('password-hint');

    // ฟังก์ชันสลับโหมด Sign In / Sign Up
    toggleAuthMode.onclick = (e) => {
        e.preventDefault();
        isSignUpMode = !isSignUpMode;

        if (isSignUpMode) {
            authTitle.innerText = "Create Account";
            nameGroup.style.display = "block";
            authMainBtn.innerText = "Create Account";
            toggleMsg.innerText = "Already have an account?";
            toggleAuthMode.innerText = "Sign in";
            passwordHint.style.display = "block";
        } else {
            authTitle.innerText = "Sign in to CLONE";
            nameGroup.style.display = "none";
            authMainBtn.innerText = "Sign In";
            toggleMsg.innerText = "Don't have an account?";
            toggleAuthMode.innerText = "Sign up";
            passwordHint.style.display = "none";
        }
    };

    // แสดง/ซ่อนรหัสผ่าน
    toggleLoginPassword.onclick = () => {
        const isPassword = loginPassword.type === 'password';
        loginPassword.type = isPassword ? 'text' : 'password';
        toggleLoginPassword.querySelector('i').className = isPassword ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    };

    // ปุ่มหลัก (Sign In / Sign Up ด้วย Email)
    authMainBtn.onclick = async () => {
        const email = loginEmail.value.trim();
        const password = loginPassword.value;
        const name = document.getElementById('reg-name').value.trim();

        if (!email || !password) {
            alert("กรุณากรอกอีเมลและรหัสผ่าน");
            return;
        }

        authMainBtn.disabled = true;
        authMainBtn.innerText = "Processing...";

        try {
            if (isSignUpMode) {
                // สมัครสมาชิกใหม่
                const userCredential = await window.createUserWithEmailAndPassword(window.firebaseAuth, email, password);
                if (name) {
                    await window.updateProfile(userCredential.user, { displayName: name });
                }
                alert("สร้างบัญชีสำเร็จ!");
            } else {
                // เข้าสู่ระบบ
                await window.signInWithEmailAndPassword(window.firebaseAuth, email, password);
            }
        } catch (error) {
            console.error('Auth Error:', error);
            let msg = "เกิดข้อผิดพลาด: ";
            if (error.code === 'auth/email-already-in-use') msg += "อีเมลนี้ถูกใช้งานแล้ว";
            else if (error.code === 'auth/weak-password') msg += "รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร";
            else if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') msg += "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
            else msg += error.message;
            alert(msg);
        } finally {
            authMainBtn.disabled = false;
            authMainBtn.innerText = isSignUpMode ? "Create Account" : "Sign In";
        }
    };

    // เข้าสู่ระบบด้วย Google (ท่าไม้ตายพรีเมียม: สวย เสถียร และไม่โดนบล็อก)
    googleLoginBtn.onclick = () => {
        const originalGoogleBtnHtml = googleLoginBtn.innerHTML;
        
        // 1. เปลี่ยนสถานะปุ่มให้ดูเหมือนการ Redirect พรีเมียม
        googleLoginBtn.disabled = true;
        googleLoginBtn.style.opacity = "0.7";
        googleLoginBtn.innerHTML = `<i class="fa fa-spinner fa-spin"></i> <span>Redirecting to Google...</span>`;

        // 2. ตั้งค่าให้เลือกบัญชีได้เสมอ
        window.googleProvider.setCustomParameters({ prompt: 'select_account' });

        // 3. เรียกหน้าต่างล็อกอิน Google
        window.signInWithPopup(window.firebaseAuth, window.googleProvider)
            .then(() => {
                // สำเร็จแล้ว คืนค่าปุ่มหากหน้าจอยังไม่เปลี่ยน (เผื่อกรณีระบบดีเลย์)
                googleLoginBtn.disabled = false;
                googleLoginBtn.style.opacity = "1";
                googleLoginBtn.innerHTML = originalGoogleBtnHtml;
            })
            .catch((error) => {
                console.error('Google Sign In Error:', error);
                if (error.code === 'auth/popup-blocked') {
                    alert('⚠️ Browser บล็อกหน้าต่างล็อกอิน! กรุณากด "อนุญาต (Allow Pop-ups)" ที่มุมขวาบนของช่องกรอก URL แล้วลองใหม่อีกครั้งครับ');
                } else if (error.code !== 'auth/popup-closed-by-user') {
                    alert('ล็อกอินผิดพลาด: ' + error.message);
                }
                // คืนค่าปุ่มหากกดยกเลิกหรือผิดพลาด
                googleLoginBtn.disabled = false;
                googleLoginBtn.style.opacity = "1";
                googleLoginBtn.innerHTML = originalGoogleBtnHtml;
            });
    };

    // เข้าสู่ระบบในฐานะ Guest (Local Bypass)
    guestLoginBtn.onclick = () => {
        currentUserUid = "guest";
        document.getElementById('login-screen').style.display = 'none';
        const userProfile = document.getElementById('user-profile');
        if (userProfile) {
            userProfile.innerHTML = `<i class="fa fa-user-secret" style="font-size:18px;"></i> <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Guest Mode</span>`;
        }
        if (apiKey) showApp();
        else showApiKeyScreen();
    };
}

// ฟังก์ชัน Logout ส่วนกลาง
async function handleLogout() {
    try {
        if (currentUserUid !== "guest") {
            await window.signOut(window.firebaseAuth);
        }
    } catch (error) {
        console.error("Sign Out Error:", error);
    }
    
    allChats = [];
    currentChatId = null;
    chatListEl.innerHTML = '';
    clearMessages();
    updateLayoutState(true);

    currentUserUid = null;
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('api-key-screen').style.display = 'none';
    document.getElementById('app-container').style.display = 'none';
    localStorage.removeItem('openrouter_api_key');
    apiKey = '';
}

// ===== จัดการหน้าจอ API Key =====

// แสดงหน้าจอให้กรอก API Key
function showApiKeyScreen() {
    apiKeyScreen.style.display = 'flex';
    appContainer.style.display = 'none';
    apiKeyInput.value = '';
    setTimeout(() => apiKeyInput.focus(), 100);
}

// แสดงหน้าแอปหลักหลังจากมี API Key แล้ว
async function showApp() {
    apiKeyScreen.style.display = 'none';
    appContainer.style.display = 'flex';
    await fetchModels();
    await fetchChats();
    if (!eventListenersSetup) {
        setupEventListeners();
        eventListenersSetup = true;
    }
}

// ตั้งค่า Event สำหรับหน้าจอ API Key
function setupApiKeyScreen() {
    // เปิด/ปิดการแสดง API Key
    toggleKeyVisibility.onclick = () => {
        const isPassword = apiKeyInput.type === 'password';
        apiKeyInput.type = isPassword ? 'text' : 'password';
        toggleKeyVisibility.querySelector('i').className = isPassword ? 'fa fa-eye-slash' : 'fa fa-eye';
    };
    // เปิดปุ่ม Save เมื่อพิมพ์ API Key
    apiKeyInput.addEventListener('input', () => {
        saveApiKeyBtn.disabled = apiKeyInput.value.trim() === '';
    });
    // กด Enter เพื่อบันทึก
    apiKeyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveApiKey();
    });
    saveApiKeyBtn.onclick = saveApiKey;
}

// บันทึก API Key — ตรวจสอบกับ Backend ก่อนว่าใช้ได้จริง
async function saveApiKey() {
    const key = apiKeyInput.value.trim();
    if (!key) return;

    // แสดงสถานะกำลังตรวจสอบ
    saveApiKeyBtn.disabled = true;
    saveApiKeyBtn.querySelector('span').textContent = 'กำลังตรวจสอบ...';

    try {
        const res = await fetch(`${BASE_URL}/validate-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUserUid || 'guest' },
            body: JSON.stringify({ api_key: key })
        });
        const result = await res.json();

        if (result.valid) {
            // ✅ Key ใช้ได้ — บันทึกและเข้าแอป
            apiKey = key;
            localStorage.setItem('openrouter_api_key', apiKey);
            showApp();
        } else {
            // ❌ Key ใช้ไม่ได้ — แสดง error
            showApiKeyError(result.message);
        }
    } catch (e) {
        showApiKeyError('ไม่สามารถเชื่อมต่อ Server ได้ กรุณาตรวจสอบว่า Backend ทำงานอยู่');
    } finally {
        saveApiKeyBtn.disabled = false;
        saveApiKeyBtn.querySelector('span').textContent = 'เริ่มต้นใช้งาน';
    }
}

// แสดงข้อความ error ใต้ช่องกรอก API Key
function showApiKeyError(message) {
    let errorEl = document.getElementById('api-key-error');
    if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.id = 'api-key-error';
        errorEl.style.cssText = 'color:#ef4444;font-size:13px;margin-top:-8px;margin-bottom:8px;text-align:left;';
        saveApiKeyBtn.parentNode.insertBefore(errorEl, saveApiKeyBtn);
    }
    errorEl.textContent = message;
}

// ===== จัดการโมเดล (เหมือน st.sidebar.selectbox) =====

// ดึงรายการโมเดลจาก Backend
async function fetchModels() {
    try {
        const res = await fetch(`${BASE_URL}/models`, { headers: { 'X-User-Id': currentUserUid || 'guest' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const models = await res.json();
        renderModelOptions(models);
    } catch (e) {
        console.error('Failed to fetch models:', e);
        // Fallback ถ้า server ยังไม่พร้อม
        renderModelOptions([
            { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (Free)' },
            { id: 'deepseek/deepseek-chat-v3-0324:free', name: 'DeepSeek V3 (Free)' },
        ]);
    }
}

// แสดงตัวเลือกโมเดลใน Dropdown และตรวจสอบว่าโมเดลที่เลือกไว้ยังมีอยู่ในรายการ
function renderModelOptions(models) {
    // ตรวจสอบว่าโมเดลที่เก็บใน localStorage ยังมีอยู่จริงหรือไม่
    const modelExists = models.some(m => m.id === selectedModel);
    if (!modelExists && models.length > 0) {
        selectedModel = models[0].id;
        localStorage.setItem('selected_model', selectedModel);
    }

    modelSelect.innerHTML = '';
    models.forEach(m => {
        const option = document.createElement('option');
        option.value = m.id;
        option.textContent = m.name;
        if (m.id === selectedModel) option.selected = true;
        modelSelect.appendChild(option);
    });
}

// ===== จัดการแชท =====

async function fetchChats() {
    try {
        const res = await fetch(`${BASE_URL}/chats`, { headers: { 'X-User-Id': currentUserUid || 'guest' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        allChats = await res.json();
        renderChatList(allChats);
    } catch (e) {
        console.error('Failed to fetch chats:', e);
    }
}

function renderChatList(chats) {
    chatListEl.innerHTML = '';
    chats.forEach(chat => {
        const div = document.createElement('div');
        div.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
        div.innerHTML = `
            <div class="chat-title" title="${chat.title}">${chat.title}</div>
            <button class="delete-btn" onclick="deleteChat(${chat.id}, event)">
                <i class="fa fa-trash"></i>
            </button>
        `;
        div.onclick = () => selectChat(chat.id);
        chatListEl.appendChild(div);
    });
}

async function selectChat(chatId) {
    currentChatId = chatId;
    renderChatList(allChats);
    clearMessages();
    updateLayoutState(true);
    try {
        const res = await fetch(`${BASE_URL}/chats/${chatId}/messages`, { headers: { 'X-User-Id': currentUserUid || 'guest' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const messages = await res.json();
        if (messages.length > 0) {
            updateLayoutState(false);
            messages.forEach(msg => appendMessage(msg.role, msg.content, false, msg.model_name));
            scrollToBottom();
        }
    } catch (e) {
        console.error('Failed to select chat:', e);
    }
}

async function createNewChat() {
    try {
        const res = await fetch(`${BASE_URL}/chats`, { method: 'POST', headers: { 'X-User-Id': currentUserUid || 'guest' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const chat = await res.json();
        allChats.unshift(chat);
        selectChat(chat.id);
    } catch (e) {
        console.error('Failed to create chat:', e);
    }
}

function deleteChat(chatId, event) {
    event.stopPropagation();
    chatIdToDelete = chatId;
    const chat = allChats.find(c => c.id === chatId);
    deleteChatTitle.textContent = chat ? chat.title : 'this chat';
    deleteModal.style.display = 'flex';
}

async function confirmDeleteChat() {
    if (!chatIdToDelete) return;
    try {
        await fetch(`${BASE_URL}/chats/${chatIdToDelete}`, { method: 'DELETE', headers: { 'X-User-Id': currentUserUid || 'guest' } });
        allChats = allChats.filter(c => c.id !== chatIdToDelete);
        if (currentChatId === chatIdToDelete) {
            currentChatId = null;
            clearMessages();
            updateLayoutState(true);
        }
        closeDeleteModal();
        renderChatList(allChats);
    } catch (e) {
        console.error('Failed to delete chat:', e);
    }
}

function closeDeleteModal() {
    deleteModal.style.display = 'none';
    chatIdToDelete = null;
}

// ===== Event Listeners =====

function setupEventListeners() {
    newChatBtn.onclick = createNewChat;

    // ระบบแนบไฟล์
    if (attachBtn && fileInput) {
        attachBtn.onclick = () => fileInput.click();
        fileInput.onchange = handleFileSelect;
    }

    // เปลี่ยนโมเดลเมื่อผู้ใช้เลือกจาก Dropdown (เหมือน st.sidebar.selectbox)
    modelSelect.onchange = () => {
        selectedModel = modelSelect.value;
        localStorage.setItem('selected_model', selectedModel);
    };

    // ปุ่มเปลี่ยน API Key
    changeKeyBtn.onclick = () => showApiKeyScreen();

    searchInput.oninput = (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allChats.filter(c => c.title.toLowerCase().includes(query));
        renderChatList(filtered);
    };

    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = messageInput.scrollHeight + 'px';
        
        // ถ้าไม่ได้กำลัง Stream อยู่ ให้คอยอัปเดตสถานะปุ่มส่งตามข้อความที่พิมพ์
        if (!abortController) {
            setStopMode(false);
        }
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAction();
        }
    });

    actionBtn.onclick = handleAction;
    confirmDeleteBtn.onclick = confirmDeleteChat;
    cancelDeleteBtn.onclick = closeDeleteModal;
    window.onclick = (event) => {
        if (event.target === deleteModal) closeDeleteModal();
    };
}

// ===== ส่งข้อความ + Streaming =====

async function handleAction() {
    if (abortController) {
        abortController.abort();
        resetToDefaultState();
        return;
    }
    const content = messageInput.value.trim();
    if (!content) return;
    // ตรวจสอบ API Key ก่อนส่ง
    if (!apiKey) {
        showApiKeyScreen();
        return;
    }

    if (!currentChatId) await createNewChat();

    messageInput.value = '';
    messageInput.style.height = 'auto';
    actionBtn.disabled = true;
    actionBtn.style.background = 'var(--btn-disabled)';
    actionBtn.style.color = '#fff';

    // รวมข้อความจาก PDF (ถ้ามี)
    let finalContent = content;
    const pdfTexts = attachedFiles
        .filter(f => f.type === 'application/pdf' && f.extractedText)
        .map(f => `--- ข้อมูลจากไฟล์ PDF: ${f.name} ---\n${f.extractedText}\n--- สิ้นสุดไฟล์ PDF ---`)
        .join("\n\n");

    if (pdfTexts) {
        finalContent = `[เอกสารแนบเพื่ออ้างอิงและสรุป]\n${pdfTexts}\n\n[คำสั่งจากผู้ใช้]: ${content}`;
    }

    appendMessage('user', content, false, null, attachedFiles); // ส่งไฟล์ปัจจุบันไปโชว์ด้วย
    abortController = new AbortController();
    setStopMode(true);
    
    // อัปเดตชื่อแชทใน Sidebar ทันทีถ้าเป็นข้อความแรก (เพื่อความลื่นไหลของ UI)
    const sidebarItems = chatListEl.querySelectorAll('.chat-item');
    sidebarItems.forEach(item => {
        if (item.dataset.id == currentChatId) {
            const titleSpan = item.querySelector('.chat-title');
            if (titleSpan && (titleSpan.textContent === 'New Chat' || titleSpan.textContent === '')) {
                titleSpan.textContent = content.substring(0, 30) + (content.length > 30 ? '...' : '');
            }
        }
    });
    
    const aiMessageContainer = appendMessage('assistant', '', true, selectedModel);

    try {
        const res = await fetch(`${BASE_URL}/chats/${currentChatId}/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUserUid || 'guest' },
            body: JSON.stringify({
                content: finalContent,
                api_key: apiKey,
                model: selectedModel
            }),
            signal: abortController.signal
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullContent = '';
        let fullReasoning = ''; // สำหรับเก็บกระบวนการคิด

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunkText = decoder.decode(value, { stream: true });
            const lines = chunkText.split('\n');
            for (let line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.replace('data: ', '').trim();
                    if (dataStr === '[DONE]') break;
                    if (!dataStr) continue;
                    try {
                        const parsed = JSON.parse(dataStr);
                        
                        // รองรับทั้งเนื้อหาหลักและเนื้อหาการคิด (Reasoning)
                        if (parsed.reasoning_content !== undefined) {
                            fullReasoning += parsed.reasoning_content;
                            updateMessageContent(aiMessageContainer, fullContent, fullReasoning);
                        } else if (parsed.content !== undefined) {
                            // เมื่อเริ่มมีเนื้อหาคำตอบ ให้พับส่วนที่คิดเก็บไปโดยอัตโนมัติ (เพื่อความสะอาด)
                            if (fullContent === "" && fullReasoning !== "") {
                                const tContainer = aiMessageContainer.thoughtDiv?.parentElement;
                                if (tContainer && !tContainer.classList.contains('collapsed')) {
                                    tContainer.classList.add('collapsed');
                                    const chevron = tContainer.querySelector('.chevron');
                                    if (chevron) chevron.className = 'fa-solid fa-chevron-right chevron';
                                }
                            }
                            fullContent += parsed.content;
                            updateMessageContent(aiMessageContainer, fullContent, fullReasoning);
                        } else if (parsed.error) {
                            fullContent += `\n**Error:** ${parsed.error}`;
                            updateMessageContent(aiMessageContainer, fullContent, fullReasoning);
                        }
                    } catch (e) {
                        console.warn('Failed to parse SSE data:', e);
                    }
                }
            }
            scrollToBottom();
        }
    } catch (e) {
        if (e.name === 'AbortError') console.log('Stream aborted');
        else console.error('Stream error:', e);
    } finally {
        // บังคับคืนค่าปุ่มทันที
        resetToDefaultState();
        
        // หลังจาก Stream จบ ให้เปิดการแสดงผลปุ่ม Copy
        if (aiMessageContainer && aiMessageContainer.contentDiv && aiMessageContainer.contentDiv.parentElement) {
            const actionRow = aiMessageContainer.contentDiv.parentElement.querySelector('.message-actions');
            if (actionRow) actionRow.style.display = 'flex';
        }
        
        // พับส่วนที่คิดเก็บไปโดยอัตโนมัติ (หลังจากตอบเสร็จ)
        if (fullReasoning !== "") {
            const tContainer = aiMessageContainer.thoughtDiv?.parentElement;
            if (tContainer && !tContainer.classList.contains('collapsed')) {
                tContainer.classList.add('collapsed');
                const chevron = tContainer.querySelector('.chevron');
                if (chevron) chevron.className = 'fa-solid fa-chevron-right chevron';
            }
        }
        attachedFiles = []; // ล้างไฟล์แนบหลังส่ง
        renderFilePreviews();
        fetchChats();
    }
}

// ===== UI Helpers =====

function setStopMode(isStop) {
    if (isStop) {
        actionBtn.classList.remove('send-mode');
        actionBtn.classList.add('stop-mode');
        actionBtn.disabled = false;
        actionBtn.style.background = 'var(--text-color)';
        actionBtn.style.color = 'var(--bg-color)';
    } else {
        actionBtn.classList.add('send-mode');
        actionBtn.classList.remove('stop-mode');
        
        const hasText = messageInput.value.trim().length > 0;
        
        if (hasText) {
            actionBtn.disabled = false;
            actionBtn.style.background = 'var(--text-color)';
            actionBtn.style.color = 'var(--bg-color)';
        } else {
            actionBtn.disabled = true;
            actionBtn.style.background = 'var(--btn-disabled)';
            actionBtn.style.color = '#fff';
        }
    }
}

function resetToDefaultState() {
    abortController = null;
    setStopMode(false);
}

function updateLayoutState(isNewChat) {
    const mainContent = document.querySelector('.main-content');
    if (isNewChat) {
        mainContent.classList.add('centered-mode');
        if (!chatContainer.contains(welcomeScreen)) {
            chatContainer.appendChild(welcomeScreen);
        }
        welcomeScreen.classList.remove('hidden');
    } else {
        mainContent.classList.remove('centered-mode');
        welcomeScreen.classList.add('hidden');
    }
}

function clearMessages() {
    chatContainer.querySelectorAll('.message').forEach(el => el.remove());
}

function appendMessage(role, content, isEmptyStream, modelName = null, files = []) {
    updateLayoutState(false);
    
    // จัดการการซ่อนข้อความ PDF (Parsing Content)
    const parsedData = parseMessageContent(content);
    const displayContent = parsedData.text;
    const extractedFiles = parsedData.files;

    // จัดการการดึงกระบวนการคิด (Thought Parsing) ออกจากเนื้อหาที่จะแสดงปกติ
    const thoughtInfo = parseThoughtPart(displayContent);
    const finalDisplayContent = thoughtInfo.mainText;
    const initialThought = thoughtInfo.thoughtText;

    const div = document.createElement('div');
    div.className = `message ${role}`;
    const inner = document.createElement('div');
    inner.className = 'message-inner';

    let thoughtBody = null;
    let mainContentDiv = null;

    if (role === 'assistant') {
        const aiAvatarDiv = document.createElement('div');
        aiAvatarDiv.className = 'message-avatar ai-avatar';
        aiAvatarDiv.style.flexShrink = '0';
        aiAvatarDiv.innerHTML = `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:var(--sidebar-bg);color:var(--text-color);font-size:18px;border-radius:50%;"><i class="fa-solid fa-robot"></i></div>`;
        inner.appendChild(aiAvatarDiv);

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.gap = '8px';
        wrapper.style.width = '100%';

        // 1. ส่วนแสดงไฟล์แนบ (ย้ายมาไว้ข้างบนสุด)
        const allFiles = [...files, ...extractedFiles];
        if (allFiles.length > 0) {
            const attachmentRow = document.createElement('div');
            attachmentRow.className = 'message-attachments';
            allFiles.forEach(file => {
                const pill = document.createElement('div');
                pill.className = `message-file-pill ${file.type === 'application/pdf' ? 'pdf-type' : ''}`;
                const icon = document.createElement('i');
                icon.className = file.type === 'application/pdf' ? 'fa-solid fa-file-pdf' : 'fa-regular fa-file-lines';
                pill.appendChild(icon);
                const nameText = document.createElement('div');
                nameText.className = 'file-name';
                nameText.textContent = file.name;
                pill.appendChild(nameText);
                attachmentRow.appendChild(pill);
            });
            wrapper.appendChild(attachmentRow);
        }

        // 2. ส่วนของ Thought (ความเห็นของ AI)
        if (initialThought || isEmptyStream) {
            const t = createThoughtBlock();
            wrapper.appendChild(t.container);
            thoughtBody = t.body;
            if (initialThought) {
                thoughtBody.innerText = initialThought;
                t.container.classList.add('collapsed');
                // ปรับไอคอนลูกศรให้ชี้ขวา (เนื่องจากถูกพับไว้สำหรับประวัติเก่า)
                const chevron = t.container.querySelector('.chevron');
                if (chevron) chevron.className = 'fa-solid fa-chevron-right chevron';
            }
        }

        // 3. ส่วนเนื้อหาข้อความ
        mainContentDiv = document.createElement('div');
        mainContentDiv.className = 'message-content';
        if (!isEmptyStream) {
            const textToRender = finalDisplayContent || " ";
            mainContentDiv.dataset.markdown = textToRender;
            updateContentHtml(mainContentDiv, textToRender);
        }
        wrapper.appendChild(mainContentDiv);

        const actionRow = document.createElement('div');
        actionRow.className = 'message-actions';
        if (isEmptyStream) {
            actionRow.style.display = 'none';
        }
        actionRow.innerHTML = `
            <button class="copy-message-btn" title="Copy">
                <i class="fa-regular fa-copy"></i>
            </button>
        `;
        const copyBtn = actionRow.querySelector('.copy-message-btn');
        copyBtn.onclick = () => {
            const rawContent = mainContentDiv.dataset.markdown || mainContentDiv.innerText;
            navigator.clipboard.writeText(rawContent).then(() => {
                const icon = copyBtn.querySelector('i');
                icon.className = 'fa-solid fa-check';
                setTimeout(() => { icon.className = 'fa-regular fa-copy'; }, 2000);
            });
        };
        wrapper.appendChild(actionRow);
        inner.appendChild(wrapper);
    } else {
        // ส่วนรของผู้ใช้ (User)
        const userWrapper = document.createElement('div');
        userWrapper.className = 'user-message-wrapper';
        userWrapper.style.display = 'flex';
        userWrapper.style.flexDirection = 'column';
        userWrapper.style.alignItems = 'flex-end';
        userWrapper.style.gap = '8px';

        // 1. ไฟล์แนบของผู้ใช้ (อยู่ด้านบน)
        if (files.length > 0) {
            const attachmentRow = document.createElement('div');
            attachmentRow.className = 'message-attachments';
            files.forEach(file => {
                const pill = document.createElement('div');
                pill.className = `message-file-pill ${file.type === 'application/pdf' ? 'pdf-type' : ''}`;
                const icon = document.createElement('i');
                icon.className = file.type === 'application/pdf' ? 'fa-solid fa-file-pdf' : 'fa-regular fa-file-lines';
                pill.appendChild(icon);
                const nameText = document.createElement('div');
                nameText.className = 'file-name';
                nameText.textContent = file.name;
                pill.appendChild(nameText);
                attachmentRow.appendChild(pill);
            });
            userWrapper.appendChild(attachmentRow);
        }

        // 2. เนื้อหาข้อความของผู้ใช้
        mainContentDiv = document.createElement('div');
        mainContentDiv.className = 'message-content';
        if (!isEmptyStream) {
            const userContent = displayContent || " ";
            mainContentDiv.dataset.markdown = userContent;
            updateContentHtml(mainContentDiv, userContent);
        }
        userWrapper.appendChild(mainContentDiv);
        inner.appendChild(userWrapper);
    }

    div.appendChild(inner);
    chatContainer.appendChild(div);
    if (!isEmptyStream && mainContentDiv) renderMath(mainContentDiv);
    scrollToBottom();

    // คืนค่าทั้ง 2 ส่วนเผื่อการอัปเดตแบบ Stream
    return { contentDiv: mainContentDiv, thoughtDiv: thoughtBody };
}

function updateMessageContent(elementsObj, rawMarkdownContent, explicitReasoning = "") {
    if (!elementsObj) return;
    const { contentDiv, thoughtDiv } = elementsObj;
    
    // 1. จัดการข้อมูลการคิด (Thought/Reasoning)
    let finalThoughtText = explicitReasoning;
    let mainText = rawMarkdownContent;

    // ถ้าไม่มีข้อมูลการคิดส่งแยกมา ให้ลองแกะจากเนื้อหาหลัก (Fallback)
    if (!finalThoughtText) {
        const thoughtInfo = parseThoughtPart(rawMarkdownContent);
        mainText = thoughtInfo.mainText;
        finalThoughtText = thoughtInfo.thoughtText;
    }

    if (finalThoughtText && thoughtDiv) {
        thoughtDiv.innerText = finalThoughtText;
        // แสดงแถบความคิดและกางออกทันทีตอนกำลังพ่น
        const container = thoughtDiv.parentElement;
        container.style.display = 'block';
        container.classList.remove('hidden');
    } else if (thoughtDiv && !finalThoughtText) {
        // ห้ามสั่งซ่อนถ้าใน thoughtDiv มีเนื้อหาเดิมสะสมอยู่แล้ว (แก้ปัญหาหายไประหว่างเปลี่ยนก้อน)
        const currentText = thoughtDiv.innerText.trim();
        if (!currentText) {
            thoughtDiv.parentElement.style.display = 'none';
        }
    }

    // 2. อัปเดตเนื้อหาหลัก
    if (contentDiv) {
        contentDiv.dataset.markdown = mainText;
        updateContentHtml(contentDiv, mainText);
        renderMath(contentDiv);
    }
}

function updateContentHtml(element, markdownContent) {
    let mathBlocks = [];
    let text = markdownContent;
    function stashMath(regex) {
        text = text.replace(regex, (match) => {
            const id = `%%%MATH_${mathBlocks.length}%%%`;
            mathBlocks.push(match);
            return id;
        });
    }
    stashMath(/\\\[[\s\S]*?\\\]/g);
    stashMath(/\\\([\s\S]*?\\\)/g);
    stashMath(/\$\$[\s\S]*?\$\$/g);
    stashMath(/(?<!\$)\$[^\$]+\$(?!\$)/g);
    let html = marked.parse(text);
    mathBlocks.forEach((block, i) => {
        const id = `%%%MATH_${i}%%%`;
        html = html.replace(id, () => block);
    });
    element.innerHTML = html;
}

function renderMath(element) {
    renderMathInElement(element, {
        delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false
    });
}

function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ===== จัดการไฟล์แนบ (File Attachment Helpers) =====

function handleFileSelect(event) {
    const files = Array.from(event.target.files);
    files.forEach(async file => {
        const fileObj = {
            file: file,
            name: file.name,
            type: file.type,
            extractedText: ""
        };

        if (file.type === 'application/pdf') {
            fileObj.extractedText = await extractTextFromPDF(file);
        }
        
        attachedFiles.push(fileObj);
        renderFilePreviews();
    });
    fileInput.value = ''; // Reset
}

async function extractTextFromPDF(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(" ");
            fullText += pageText + "\n";
        }
        return fullText;
    } catch (e) {
        console.error("PDF Extraction Error:", e);
        return "[Error extracting text from PDF]";
    }
}

function renderFilePreviews() {
    filePreviewContainer.innerHTML = '';
    if (attachedFiles.length === 0) {
        filePreviewContainer.style.display = 'none';
        return;
    }

    filePreviewContainer.style.display = 'flex';
    attachedFiles.forEach((file, index) => {
        const pill = document.createElement('div');
        pill.className = 'file-pill';
        
        // ตรวจสอบว่าเป็นรูปภาพหรือไม่เพื่อแสดง Thumbnail
        if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            const reader = new FileReader();
            reader.onload = (e) => img.src = e.target.result;
            reader.readAsDataURL(file.file);
            pill.appendChild(img);
        } else {
            const icon = document.createElement('i');
            icon.className = file.type === 'application/pdf' ? 'fa-solid fa-file-pdf' : 'fa-regular fa-file-lines';
            if (file.type === 'application/pdf') icon.style.color = '#ff5555';
            pill.appendChild(icon);
        }

        const nameSpan = document.createElement('span');
        nameSpan.textContent = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;
        pill.appendChild(nameSpan);

        const removeBtn = document.createElement('div');
        removeBtn.className = 'remove-file';
        removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        removeBtn.onclick = () => removeFile(index);
        pill.appendChild(removeBtn);

        filePreviewContainer.appendChild(pill);
    });
}

function removeFile(index) {
    attachedFiles.splice(index, 1);
    renderFilePreviews();
}

// ===== ฟังก์ชันสำหรับตรวจจับและซ่อนข้อมูล PDF ในแชท (Content Parser) =====

function parseMessageContent(rawContent) {
    if (!rawContent || typeof rawContent !== 'string') return { text: rawContent, files: [] };

    const TAG = "[เอกสารแนบเพื่ออ้างอิงและสรุป]";
    if (!rawContent.includes(TAG)) return { text: rawContent, files: [] };

    let text = rawContent;
    let files = [];

    // ดึงข้อมูลชื่อไฟล์ PDF ออกมา (Regex สำหรับดึงระหว่าง --- ข้อมูลจากไฟล์ PDF: และ ---)
    const nameRegex = /--- ข้อมูลจากไฟล์ PDF: (.*?) ---/g;
    let match;
    while ((match = nameRegex.exec(rawContent)) !== null) {
        files.push({ name: match[1], type: 'application/pdf' });
    }

    // ตัดส่วน Context ทิ้ง เหลือแต่คำสั่งจากผู้ใช้จริงๆ
    const userPromptRegex = /\[คำสั่งจากผู้ใช้\]: ([\s\S]*)$/;
    const contentMatch = rawContent.match(userPromptRegex);
    if (contentMatch) {
        text = contentMatch[1].trim();
    } else {
        // กรณีหาแท็กปิดไม่เจอ ให้ตัดเอาแค่ส่วนสุดท้ายหรือส่วนที่เป็น User text
        text = rawContent.split(TAG).pop().trim();
    }

    return { text, files };
}

// ===== ผู้ช่วยตรวจจับกระบวนการคิด (Thought Parser) =====
function parseThoughtPart(content) {
    if (!content) return { mainText: "", thoughtText: "" };

    // รูปแบบหลัก: <thought>เนื้อหา</thought>
    const thoughtRegex = /<thought>([\s\S]*?)<\/thought>/;
    const match = content.match(thoughtRegex);

    if (match) {
        const thoughtText = match[1].trim();
        const mainText = content.replace(thoughtRegex, "").trim();
        return { mainText, thoughtText };
    }

    // กรณีโมเดลกำลัง Stream และยังไม่มีปิดแท็ก
    if (content.includes("<thought>")) {
        const parts = content.split("<thought>");
        return { 
            mainText: parts[0]?.trim() || "", 
            thoughtText: parts[1]?.trim() || "" 
        };
    }

    return { mainText: content, thoughtText: "" };
}

function createThoughtBlock() {
    const container = document.createElement('div');
    container.className = 'thought-container';
    
    const header = document.createElement('div');
    header.className = 'thought-header';
    header.innerHTML = `
        <i class="fa-regular fa-lightbulb bulb"></i>
        <span>Thought for a moment</span>
        <i class="fa-solid fa-chevron-down chevron" style="margin-left: auto; font-size: 10px;"></i>
    `;
    
    const body = document.createElement('div');
    body.className = 'thought-content';
    
    header.onclick = () => {
        container.classList.toggle('collapsed');
        const chevron = header.querySelector('.chevron');
        if (container.classList.contains('collapsed')) {
            chevron.className = 'fa-solid fa-chevron-right chevron';
        } else {
            chevron.className = 'fa-solid fa-chevron-down chevron';
        }
    };
    
    container.appendChild(header);
    container.appendChild(body);
    
    return { container, body };
}
