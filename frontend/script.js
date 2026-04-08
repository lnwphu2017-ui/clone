// URL หลักของ API สำหรับคุยกับ Backend
const BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:8000/api' : '/api';
let current_chat_id = null;
let abort_controller = null;
let current_user_uid = null;
let current_user_photo = '';
let pending_message = null; // ✅ เก็บข้อความที่พิมพ์ค้างไว้ก่อน Login
let pending_files = [];    // ✅ เก็บไฟล์ที่แนบค้างไว้ก่อน Login

// ===== ตัวแปรสำหรับจัดการ API Key และ Model (เก็บใน localStorage เหมือน st.session_state) =====
let api_key = localStorage.getItem('openrouter_api_key') || '';
let selected_model = localStorage.getItem('selected_model') || 'google/gemini-2.0-flash-001';

// อ้างอิง Element หลัก
const chat_list_el = document.getElementById('history-list');
const chat_container = document.getElementById('chat-container');
const message_input = document.getElementById('message-input');
const action_btn = document.getElementById('action-btn');
const new_chat_btn = document.getElementById('new-chat-btn');
const search_input = document.getElementById('search-chat');
const welcome_screen = document.getElementById('welcome-screen');
const delete_modal = document.getElementById('delete-modal');
const delete_chat_title = document.getElementById('delete-chat-title');
const confirm_delete_btn = document.getElementById('confirm-delete');
const cancel_delete_btn = document.getElementById('cancel-delete');
const file_input = document.getElementById('file-input');
const file_preview_container = document.getElementById('file-preview-container');
const attach_btn = document.getElementById('attach-btn');
const sidebar_el = document.getElementById('sidebar');
const toggle_sidebar_btn = document.getElementById('toggle-sidebar-btn');
const main_sidebar_toggle = document.getElementById('main-sidebar-toggle');
const new_chat_btn_persistent = document.getElementById('new-chat-btn-persistent');

// ปุ่มใหม่ใน Sidebar Internal
const toggle_sidebar_internal = document.getElementById('toggle-sidebar-internal');
const new_chat_internal = document.getElementById('new-chat-internal');
const launch_btn = document.getElementById('launch-btn');
const settings_btn = document.getElementById('settings-btn');
const chat_header_title = document.getElementById('chat-header-title');
const main_content = document.querySelector('.main-content');

let attached_files = [];

// อ้างอิง Element สำหรับ Setup Wizard (Unified Modal)
const setup_wizard_modal = document.getElementById('setup-wizard-modal');
const wizard_step_1 = document.getElementById('wizard-step-1');
const wizard_step_2 = document.getElementById('wizard-step-2');
const wizard_api_key_input = document.getElementById('wizard-api-key-input');
const save_wizard_api_key_btn = document.getElementById('save-wizard-api-key-btn');
const toggle_wizard_key_visibility = document.getElementById('toggle-wizard-key-visibility');
const close_setup_modal_btn = document.getElementById('close-setup-modal');

// อ้างอิง Element อื่นๆ
const app_container = document.getElementById('app-container');
const model_select = document.getElementById('model-select');
const change_key_btn = document.getElementById('change-key-btn');
const user_profile = document.getElementById('user-profile');

// อ้างอิง Element สำหรับ Settings Screen
const settings_screen = document.getElementById('settings-screen');
const close_settings_btn = document.getElementById('close-settings');
const settings_avatar = document.getElementById('settings-avatar');
const settings_user_name = document.getElementById('settings-user-name');
const settings_user_email = document.getElementById('settings-user-email');
const settings_api_key_input = document.getElementById('settings-api-key');
const save_settings_key_btn = document.getElementById('save-settings-key');
const toggle_settings_key = document.getElementById('toggle-settings-key');
const settings_auth_btn = document.getElementById('settings-auth-btn');

let chat_id_to_delete = null;
let all_chats = [];
let all_models = []; // ✅ เก็บรายชื่อโมเดลทั้งหมดเพื่อใช้ในการ Filter
let event_listeners_setup = false; // ป้องกันการตั้ง Event ซ้ำ
let is_auto_scroll_enabled = true;
let is_sending = false; // ✅ ป้องกันการกดส่งซ้ำ

// ✅ Elements สำหรับ Custom Model Selector
const model_toggle_btn = document.getElementById('model-toggle-btn');
const model_dropdown_menu = document.getElementById('model-dropdown-menu');
const model_search_input = document.getElementById('model-search-input');
const model_list_container = document.getElementById('model-list-container');
const current_model_display = document.getElementById('current-model-display');

window.initApp = async function () {
    await Init();
};

// ฟังก์ชันเริ่มต้นการทำงาน
async function Init() {
    SetupSetupWizard(); // ✅ ใช้ Wizard แทนหน้าจอแยกเดิม
    
    // ... rest of Init remains similar logic ...

    // ✅ ปรับเปลี่ยน: เริ่มต้นแอปในสถานะปกติ (ไม่ต้องรอ Firebase)
    // แต่จะไม่เซ็ตเป็น Guest อัตโนมัติ เพื่อให้เด้ง Login เมื่อพยายามแชท
    if (!current_user_uid) {
        if (user_profile) {
            user_profile.innerHTML = `<i class="fa-solid fa-circle-user" style="font-size:20px; opacity:0.7;"></i> <span style="font-weight:500; opacity:0.8;">Sign in to chat</span>`;
        }
        ShowApp(); // แสดงหน้าแอปหลักเป็นหน้าแรกเสมอ
    }

    // จัดการผลลัพธ์หลังจาก Redirect มาจาก Google (Non-blocking เพื่อป้องกันการโหลดค้าง)
    window.getRedirectResult(window.firebaseAuth).then((result) => {
        if (result && result.user) {
            console.log("🔥 Redirect result found:", result.user.email);
            current_user_uid = result.user.email;
            // ถ้าได้ผลลัพธ์จะไปอัปเดตต่อใน onAuthStateChanged
        }
    }).catch((error) => {
        if (error.code !== 'auth/internal-error') {
            console.error("❌ Redirect Result Error:", error);
        }
    });

    // ดักจับสถานะล็อกอินผ่าน Firebase
    window.onAuthStateChanged(window.firebaseAuth, (user) => {
        console.log("🎯 Auth State Changed:", user ? user.email : "Logged Out");

        if (user) {
            current_user_uid = user.email;
            current_user_photo = user.photoURL || '';
            // document.getElementById('login-screen').style.display = 'none'; // ✅ ลบบรรทัดที่เป็นบั๊กออก (Element นี้ถูกลบไปแล้ว)

            if (user_profile) {
                user_profile.innerHTML = `<img src="${user.photoURL || ''}" style="width:24px;height:24px;border-radius:50%;" onerror="this.style.display='none'"> <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${user.email}</span>`;
            }

            // อัปเดตข้อมูลในหน้า Settings
            if (settings_user_name) settings_user_name.textContent = user.displayName || 'User';
            if (settings_user_email) settings_user_email.textContent = user.email;
            if (settings_avatar) settings_avatar.src = user.photoURL || '';
            if (settings_api_key_input) settings_api_key_input.value = api_key;
            if (settings_auth_btn) settings_auth_btn.textContent = 'Sign out';

            // ✅ ถ้ามีข้อความค้างอยู่ (Pending Message) หลังจากล็อกอินสำเร็จ
            if (pending_message) {
                if (api_key) {
                    HideSetupWizard();
                    HandleAction(); // ดำเนินการส่งต่อทันที
                } else {
                    ShowSetupWizard(2); // ✅ ถ้ายังไม่มี Key ให้สลับไปหน้า Step 2 ใน Modal เดิม
                }
            } else if (api_key) {
                HideSetupWizard();
                ShowApp();
            } else {
                // ถ้าล็อกอินแล้วแต่ไม่มี Key และไม่ได้กดแชทค้างไว้ 
                // ให้เช็คว่าอยู่ที่หน้าไหน ถ้าอยู่หน้าแอปให้โชว์ Wizard Step 2
                if (setup_wizard_modal.style.display === 'flex' || app_container.style.display === 'none') {
                    ShowSetupWizard(2);
                }
            }
        } else if (!user) {
            // ✅ สถานะ Unauthenticated
            current_user_uid = null;
            current_user_photo = '';
            
            // อัปเดตข้อมูลในหน้า Settings ให้เป็นสถานะยังไม่ได้ล็อกอิน
            if (settings_user_name) settings_user_name.textContent = 'Please sign in';
            if (settings_user_email) settings_user_email.textContent = 'Sign in to save your chats';
            if (user_profile) {
                user_profile.innerHTML = `<i class="fa-solid fa-circle-user" style="font-size:20px; opacity:0.7;"></i> <span style="font-weight:500; opacity:0.8;">Sign in to chat</span>`;
            }
            if (settings_auth_btn) settings_auth_btn.textContent = 'Sign in';
        }
    });

    // ตั้งค่าให้กดที่ Profile ใน Sidebar เพื่อเปิด Settings ได้เลย (Shortcut)
    if (user_profile) {
        user_profile.onclick = ShowSettingsScreen;
        user_profile.style.cursor = 'pointer';
    }

    // ระบบหุ้ม Sidebar (Collapse)
    SetupSidebarToggle();
}

// ฟังก์ชันควบคุมการหด-ขยาย Sidebar
function SetupSidebarToggle() {
    // โหลดสถานะล่าสุดจาก localStorage
    const is_collapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (is_collapsed) {
        sidebar_el.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
    }

    // ฟังก์ชันช่วยสลับสถานะ
    const ToggleSidebar = () => {
        const is_currently_collapsed = sidebar_el.classList.toggle('collapsed');
        document.body.classList.toggle('sidebar-collapsed', is_currently_collapsed);
        localStorage.setItem('sidebar_collapsed', is_currently_collapsed);
    };

    if (main_sidebar_toggle) main_sidebar_toggle.onclick = ToggleSidebar;
    if (toggle_sidebar_btn) toggle_sidebar_btn.onclick = ToggleSidebar;
}

// ===== จัดการหน้าจอ Auth Modal ใหม่ (Google Only) =====

// ===== จัดการ Unified Setup Wizard (Login + API Key) =====

function SetupSetupWizard() {
    const google_login_btn_modal = document.getElementById('login-google-btn-modal');

    // ปุ่มปิด Modal
    if (close_setup_modal_btn) {
        close_setup_modal_btn.onclick = HideSetupWizard;
    }

    // Google Login Logic
    if (google_login_btn_modal) {
        google_login_btn_modal.onclick = () => {
            const original_btn_html = google_login_btn_modal.innerHTML;
            google_login_btn_modal.disabled = true;
            google_login_btn_modal.style.opacity = "0.7";
            google_login_btn_modal.querySelector('span').textContent = 'Authenticating...';

            window.signInWithPopup(window.firebaseAuth, window.googleProvider)
                .then(() => {
                    // Note: onAuthStateChanged จะเป็นคนเช็คต่อว่าได้รับ User หรือยัง
                    // ถ้าได้แล้ว มันจะสลับไป Step 2 (API Key) หรือปิด Modal ให้เอง
                })
                .catch((error) => {
                    console.error('Google Sign In Error:', error);
                    alert('ล็อกอินผิดพลาด: ' + (error.message || 'Unknown error'));
                    google_login_btn_modal.disabled = false;
                    google_login_btn_modal.style.opacity = "1";
                    google_login_btn_modal.innerHTML = original_btn_html;
                });
        };
    }

    // API Key Step Logic
    if (toggle_wizard_key_visibility) {
        toggle_wizard_key_visibility.onclick = () => {
            const is_password = wizard_api_key_input.type === 'password';
            wizard_api_key_input.type = is_password ? 'text' : 'password';
            toggle_wizard_key_visibility.querySelector('i').className = is_password ? 'fa fa-eye-slash' : 'fa fa-eye';
        };
    }

    if (wizard_api_key_input) {
        wizard_api_key_input.addEventListener('input', () => {
            save_wizard_api_key_btn.disabled = wizard_api_key_input.value.trim() === '';
        });
        wizard_api_key_input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !save_wizard_api_key_btn.disabled) SaveWizardApiKey();
        });
    }

    if (save_wizard_api_key_btn) {
        save_wizard_api_key_btn.onclick = SaveWizardApiKey;
    }

    // ปิด Modal เมื่อคลิกด้านนอก
    window.addEventListener('click', (e) => {
        if (e.target === setup_wizard_modal) HideSetupWizard();
    });
}

function ShowSetupWizard(step = 1) {
    if (!setup_wizard_modal) return;
    
    setup_wizard_modal.style.display = 'flex';
    is_sending = false;
    
    if (step === 1) {
        wizard_step_1.style.display = 'block';
        wizard_step_2.style.display = 'none';
    } else {
        wizard_step_1.style.display = 'none';
        wizard_step_2.style.display = 'block';
        setTimeout(() => wizard_api_key_input.focus(), 100);
    }
}

function HideSetupWizard() {
    if (setup_wizard_modal) setup_wizard_modal.style.display = 'none';
}

function ShowAuthModal() {
    ShowSetupWizard(1);
}

function ShowApiKeyScreen() {
    ShowSetupWizard(2);
}

// บันทึก API Key จาก Wizard
async function SaveWizardApiKey() {
    const key = wizard_api_key_input.value.trim();
    if (!key) return;

    save_wizard_api_key_btn.disabled = true;
    const original_text = save_wizard_api_key_btn.innerHTML;
    save_wizard_api_key_btn.innerHTML = '<span>Validating...</span>';

    try {
        const res = await fetch(`${BASE_URL}/validate-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': current_user_uid || 'guest' },
            body: JSON.stringify({ api_key: key })
        });
        const result = await res.json();

        if (result.valid) {
            api_key = key;
            localStorage.setItem('openrouter_api_key', api_key);
            
            HideSetupWizard();
            ShowApp();

            // ✅ ถ้ามีข้อความค้างอยู่ ให้ส่งทันที
            if (pending_message) {
                HandleAction();
            }
        } else {
            alert('Invalid API Key: ' + result.message);
        }
    } catch (e) {
        alert('Connection error. Please try again.');
    } finally {
        save_wizard_api_key_btn.disabled = false;
        save_wizard_api_key_btn.innerHTML = original_text;
    }
}

// ฟังก์ชัน Logout ส่วนกลาง
async function HandleLogout() {
    try {
        await window.signOut(window.firebaseAuth);
    } catch (error) {
        console.error("Sign Out Error:", error);
    }
    
    all_chats = [];
    current_chat_id = null;
    chat_list_el.innerHTML = '';
    ClearMessages(); // ✅ สมมติว่ามีฟังก์ชันนี้ และเดี๋ยวจะเปลี่ยนเป็น PascalCase
    UpdateLayoutState(true);

    current_user_uid = null;
    ShowAuthModal(); // กลับไปแสดงหน้า Auth modal (Step 1)
    HideSetupWizard(); 
    app_container.style.display = 'none';
    CloseSettingsScreen();
    localStorage.removeItem('openrouter_api_key');
    api_key = '';
}

function ShowSettingsScreen() {
    if (settings_screen) {
        settings_screen.style.display = 'flex';
        if (settings_api_key_input) settings_api_key_input.value = api_key;
        
        // อัปเดตสถานะปุ่ม Auth ในหน้า Settings
        if (settings_auth_btn) {
            if (current_user_uid && current_user_uid !== "guest") {
                settings_auth_btn.innerHTML = `<i class="fa-solid fa-right-from-bracket"></i> Logout`;
                settings_auth_btn.classList.add('logout-mode');
            } else {
                settings_auth_btn.innerHTML = `<i class="fa-brands fa-google"></i> Login with Google`;
                settings_auth_btn.classList.remove('logout-mode');
            }
        }
    }
}

function CloseSettingsScreen() {
    if (settings_screen) settings_screen.style.display = 'none';
}

async function SaveSettingsApiKey() {
    const key = settings_api_key_input.value.trim();
    if (!key) return;

    save_settings_key_btn.disabled = true;
    save_settings_key_btn.textContent = 'Saving...';

    api_key = key;
    localStorage.setItem('openrouter_api_key', api_key);
    
    setTimeout(() => {
        save_settings_key_btn.disabled = false;
        save_settings_key_btn.textContent = 'Save changes';
        CloseSettingsScreen();
    }, 500);
}

function ShowLoginScreen() {
    CloseSettingsScreen();
    ShowAuthModal();
}

// แสดงหน้าแอปหลักหลังจากมี API Key แล้ว
async function ShowApp() {
    HideSetupWizard();
    app_container.style.display = 'flex';
    
    // ✅ ตรวจสอบสถานะเริ่มต้น ถ้าไม่มีแชทให้โชว์หน้า New Chat
    if (!current_chat_id) {
        UpdateLayoutState(true);
    }
    
    await FetchModels();
    await FetchChats();
    if (!event_listeners_setup) {
        SetupEventListeners();
        event_listeners_setup = true;
    }
}

// ===== จัดการโมเดล (เหมือน st.sidebar.selectbox) =====

// ดึงรายการโมเดลจาก Backend
async function FetchModels() {
    try {
        const res = await fetch(`${BASE_URL}/models`, { headers: { 'X-User-Id': current_user_uid || 'guest' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const models = await res.json();
        RenderModelOptions(models);
    } catch (e) {
        console.error('Failed to fetch models:', e);
        // Fallback ถ้า server ยังไม่พร้อม
        RenderModelOptions([
            { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (Free)' },
            { id: 'deepseek/deepseek-chat-v3-0324:free', name: 'DeepSeek V3 (Free)' },
            { id: 'openai/gpt-oss-20b:free', name: 'GPT-OSS 20B (Free)' },
        ]);
    }
}

// แสดงตัวเลือกโมเดลใน Custom Dropdown และตรวจสอบว่าโมเดลที่เลือกไว้ยังมีอยู่ในรายการ
function RenderModelOptions(models) {
    all_models = models; // เก็บไว้ใช้ค้นหา
    
    // ตรวจสอบว่าโมเดลที่เก็บใน localStorage ยังมีอยู่จริงหรือไม่
    const model_exists = models.some(m => m.id === selected_model);
    if (!model_exists && models.length > 0) {
        selected_model = models[0].id;
        localStorage.setItem('selected_model', selected_model);
    }

    // อัปเดตชื่อโมเดลที่ปุ่ม Toggle
    const current_model = models.find(m => m.id === selected_model);
    if (current_model && current_model_display) {
        current_model_display.textContent = current_model.name;
    }

    RenderCustomModelList(models);
}

// เรนเดอร์รายการโมเดลใน Dropdown
function RenderCustomModelList(filtered_models) {
    if (!model_list_container) return;
    model_list_container.innerHTML = '';
    
    filtered_models.forEach(m => {
        const item = document.createElement('div');
        item.className = `model-item ${m.id === selected_model ? 'active' : ''}`;
        item.innerHTML = `
            <span>${m.name}</span>
            ${m.id === selected_model ? '<i class="fa-solid fa-check" style="color: #4c82f7;"></i>' : ''}
        `;
        item.onclick = () => {
            selected_model = m.id;
            localStorage.setItem('selected_model', selected_model);
            if (current_model_display) current_model_display.textContent = m.name;
            if (model_dropdown_menu) model_dropdown_menu.style.display = 'none';
            RenderCustomModelList(all_models); // รีเฟรชสถานะ active
        };
        model_list_container.appendChild(item);
    });

    if (filtered_models.length === 0) {
        const empty = document.createElement('div');
        empty.style.padding = '20px';
        empty.style.textAlign = 'center';
        empty.style.color = '#888';
        empty.style.fontSize = '13px';
        empty.textContent = 'No models found';
        model_list_container.appendChild(empty);
    }
}

// ===== จัดการแชท =====

async function FetchChats() {
    try {
        const res = await fetch(`${BASE_URL}/chats`, { headers: { 'X-User-Id': current_user_uid || 'guest' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        all_chats = await res.json();
        RenderChatList(all_chats);
    } catch (e) {
        console.error('Failed to fetch chats:', e);
    }
}

function RenderChatList(chats) {
    chat_list_el.innerHTML = '';
    chats.forEach(chat => {
        const div = document.createElement('div');
        div.className = `chat-item ${chat.id === current_chat_id ? 'active' : ''}`;
        div.dataset.id = chat.id;
        div.innerHTML = `
            <div class="chat-title" title="${chat.title}">${chat.title}</div>
            <button class="delete-btn" onclick="DeleteChat(${chat.id}, event)">
                <i class="fa fa-trash"></i>
            </button>
        `;
        div.onclick = () => SelectChat(chat.id);
        chat_list_el.appendChild(div);
    });
}

async function SelectChat(chat_id) {
    current_chat_id = chat_id;
    const chat = all_chats.find(c => c.id === chat_id);
    if (chat_header_title) {
        chat_header_title.textContent = chat ? chat.title : 'New chat';
    }
    RenderChatList(all_chats);
    ClearMessages();
    UpdateLayoutState(true);
    try {
        const res = await fetch(`${BASE_URL}/chats/${chat_id}/messages`, { headers: { 'X-User-Id': current_user_uid || 'guest' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const messages = await res.json();
        if (messages.length > 0) {
            UpdateLayoutState(false);
            messages.forEach(msg => AppendMessage(msg.role, msg.content, false, msg.model_name));
            ScrollToBottom();
        }
    } catch (e) {
        console.error('Failed to select chat:', e);
    }
}

async function CreateNewChat() {
    try {
        const res = await fetch(`${BASE_URL}/chats`, { method: 'POST', headers: { 'X-User-Id': current_user_uid || 'guest' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const chat = await res.json();
        all_chats.unshift(chat);
        SelectChat(chat.id);
    } catch (e) {
        console.error('Failed to create chat:', e);
    }
}

function DeleteChat(chat_id, event) {
    event.stopPropagation();
    chat_id_to_delete = chat_id;
    const chat = all_chats.find(c => c.id === chat_id);
    delete_chat_title.textContent = chat ? chat.title : 'this chat';
    delete_modal.style.display = 'flex';
}

async function ConfirmDeleteChat() {
    if (!chat_id_to_delete) return;
    try {
        await fetch(`${BASE_URL}/chats/${chat_id_to_delete}`, { method: 'DELETE', headers: { 'X-User-Id': current_user_uid || 'guest' } });
        all_chats = all_chats.filter(c => c.id !== chat_id_to_delete);
        if (current_chat_id === chat_id_to_delete) {
            current_chat_id = null;
            ClearMessages();
            UpdateLayoutState(true);
        }
        CloseDeleteModal();
        RenderChatList(all_chats);
    } catch (e) {
        console.error('Failed to delete chat:', e);
    }
}

function CloseDeleteModal() {
    delete_modal.style.display = 'none';
    chat_id_to_delete = null;
}

// ===== Event Listeners =====

function SetupEventListeners() {
    // ระบบสร้างแชทใหม่ (รองรับทั้งปุ่มข้างนอกและปุ่มใน Sidebar)
    const HandleNewChatAction = () => {
        current_chat_id = null;
        if (chat_header_title) chat_header_title.textContent = '';
        UpdateLayoutState(true);
        ClearMessages();
    };

    if (new_chat_btn) new_chat_btn.onclick = HandleNewChatAction;
    if (new_chat_btn_persistent) new_chat_btn_persistent.onclick = HandleNewChatAction;
    if (new_chat_internal) new_chat_internal.onclick = HandleNewChatAction;

    // ปุ่มสลับสถานะ Sidebar
    const ToggleSidebar = () => {
        const is_currently_collapsed = sidebar_el.classList.toggle('collapsed');
        document.body.classList.toggle('sidebar-collapsed', is_currently_collapsed);
        localStorage.setItem('sidebar_collapsed', is_currently_collapsed);
    };

    if (main_sidebar_toggle) main_sidebar_toggle.onclick = ToggleSidebar;
    if (toggle_sidebar_btn) toggle_sidebar_btn.onclick = ToggleSidebar;
    if (toggle_sidebar_internal) toggle_sidebar_internal.onclick = ToggleSidebar;

    // ปุ่ม Launch & Settings (พื้นฐาน)
    if (launch_btn) {
        launch_btn.onclick = () => alert("Launch functionality coming soon!");
    }
    if (settings_btn) {
        settings_btn.onclick = ShowSettingsScreen;
    }
    if (close_settings_btn) {
        close_settings_btn.onclick = CloseSettingsScreen;
    }
    if (save_settings_key_btn) {
        save_settings_key_btn.onclick = SaveSettingsApiKey;
    }
    if (toggle_settings_key) {
        toggle_settings_key.onclick = () => {
            const is_password = settings_api_key_input.type === 'password';
            settings_api_key_input.type = is_password ? 'text' : 'password';
            toggle_settings_key.querySelector('i').className = is_password ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
        };
    }
    if (settings_auth_btn) {
        settings_auth_btn.onclick = () => {
            if (current_user_uid && current_user_uid !== "guest") {
                HandleLogout();
            } else {
                ShowLoginScreen();
            }
        };
    }

    // ✅ Listeners สำหรับการแนบไฟล์
    if (attach_btn && file_input) {
        attach_btn.onclick = () => file_input.click();
        file_input.onchange = HandleFileSelect;
    }

    // ✅ Logic สำหรับ Custom Model Selector (Premium Dropdown)
    if (model_toggle_btn && model_dropdown_menu) {
        model_toggle_btn.onclick = (e) => {
            e.stopPropagation();
            const is_visible = model_dropdown_menu.style.display === 'flex';
            model_dropdown_menu.style.display = is_visible ? 'none' : 'flex';
            
            if (!is_visible) {
                // รีเซ็ตช่องค้นหาเมื่อเปิดเมนู
                if (model_search_input) {
                    model_search_input.value = '';
                    RenderCustomModelList(all_models);
                    setTimeout(() => model_search_input.focus(), 50);
                }
            }
        };

        if (model_search_input) {
            model_search_input.onclick = (e) => e.stopPropagation(); // กันเมนูปิดเวลาคลิกช่องค้นหา
            model_search_input.oninput = (e) => {
                const query = e.target.value.toLowerCase();
                const filtered = all_models.filter(m => m.name.toLowerCase().includes(query));
                RenderCustomModelList(filtered);
            };
        }

        // ปิดเมนูเมื่อคลิกที่อื่นในหน้าจอ
        document.addEventListener('click', () => {
            if (model_dropdown_menu) model_dropdown_menu.style.display = 'none';
        });
    }

    if (search_input) {
        search_input.oninput = (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = all_chats.filter(c => c.title.toLowerCase().includes(query));
            RenderChatList(filtered);
        };
    }

    if (message_input) {
        message_input.addEventListener('input', () => {
            message_input.style.height = 'auto';
            message_input.style.height = message_input.scrollHeight + 'px';
            
            if (!abort_controller) {
                SetStopMode(false);
            }
        });

        message_input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (!is_sending) HandleAction(); // ✅ เช็คสถานะก่อนเรียกใช้งานซ้ำ
            }
        });
    }

    if (action_btn) action_btn.onclick = HandleAction;
    if (confirm_delete_btn) confirm_delete_btn.onclick = ConfirmDeleteChat;
    if (cancel_delete_btn) cancel_delete_btn.onclick = CloseDeleteModal;

    // ระบบตรวจจับการ Scroll
    if (chat_container) {
        chat_container.addEventListener('scroll', () => {
            // ✅ เพิ่ม Threshold เป็น 100px เพื่อให้ Smart Scroll ทำงานได้ยืดหยุ่นขึ้น
            const is_at_bottom = chat_container.scrollHeight - chat_container.scrollTop - chat_container.clientHeight <= 100;
            is_auto_scroll_enabled = is_at_bottom;
        });
    }
    
    window.onclick = (event) => {
        if (event.target === delete_modal) CloseDeleteModal();
    };
}

// ===== ส่งข้อความ + Streaming =====

async function HandleAction() {
    // ✅ ถ้ามี abort_controller อยู่ หมายความว่าอยู่ใน Stop Mode ให้ทำการยกเลิกการทำงาน
    if (abort_controller) {
        console.log("🛑 User requested to stop streaming...");
        abort_controller.abort();
        return;
    }

    if (is_sending) return;
    
    // ✅ จุดเช็คสำคัญ: หากยังไม่ล็อกอิน ให้เก็บข้อความลง Pending และเรียก Auth Modal
    if (!current_user_uid) {
        const content_to_save = message_input.value.trim();
        if (content_to_save) {
            pending_message = content_to_save;
            pending_files = [...attached_files];
            ShowAuthModal();
        }
        return;
    }

    const content = pending_message || message_input.value.trim();
    if (!content) return;
    
    // ตรวจสอบ API Key ก่อนส่ง
    if (!api_key) {
        // หากยังไม่มี Key ให้เก็บข้อความไว้ใน pending_message ก่อน
        pending_message = content;
        pending_files = pending_files.length > 0 ? [...pending_files] : [...attached_files];
        ShowApiKeyScreen();
        return;
    }

    // ล้างสถานะ Pending เมื่อมั่นใจว่ามี Key และกำลังจะส่งแน่นอน
    pending_message = null;
    const current_files = pending_files.length > 0 ? [...pending_files] : [...attached_files];
    pending_files = [];

    // 🔒 [LOCK] เริ่มกระบวนการส่งข้อความ
    is_sending = true;
    
    try {
        // ปรับแต่ง UI ทันทีเมื่อเริ่มส่ง
        action_btn.disabled = true;
        action_btn.style.opacity = '0.5';
        message_input.value = '';
        message_input.style.height = 'auto';

        // 🏠 [STEP 1] จัดการห้องแชท
        if (!current_chat_id) {
            await CreateNewChat();
            ClearMessages();
        }

        // 📄 [STEP 2] เตรียมเนื้อหา (PDF + Message)
        let final_content = content;
        const pdf_texts = attached_files
            .filter(f => f.type === 'application/pdf' && f.extractedText)
            .map(f => `--- ข้อมูลจากไฟล์ PDF: ${f.name} ---\n${f.extractedText}\n--- สิ้นสุดไฟล์ PDF ---`)
            .join("\n\n");

        if (pdf_texts) {
            final_content = `[เอกสารแนบเพื่ออ้างอิงและสรุป]\n${pdf_texts}\n\n[คำสั่งจากผู้ใช้]: ${content}`;
        }

        // 💬 [STEP 3] แสดงข้อความผู้ใช้ในหน้าจอ
        AppendMessage('user', content, false, null, current_files);
        
        // 🚨 [STEP 4] เตรียม Streaming
        abort_controller = new AbortController();
        SetStopMode(true);
        is_auto_scroll_enabled = true;
        
        // ล้างไฟล์แนบหลังเตรียมส่ง
        attached_files = [];
        if (file_preview_container) file_preview_container.innerHTML = '';
        UpdateLayoutState(false);

        // อัปเดตชื่อแชทใน Sidebar ทันที
        const sidebar_items = chat_list_el.querySelectorAll('.chat-item');
        sidebar_items.forEach(item => {
            if (item.dataset.id == String(current_chat_id)) {
                const title_span = item.querySelector('.chat-title');
                if (title_span && (title_span.textContent === 'New Chat' || title_span.textContent === '')) {
                    const new_title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
                    title_span.textContent = new_title;
                    if (chat_header_title) chat_header_title.textContent = new_title;
                }
            }
        });

        // 🤖 [STEP 5] เริ่มการ Streaming จาก AI
        const ai_message_container = AppendMessage('assistant', '', true, selected_model);

        const res = await fetch(`${BASE_URL}/chats/${current_chat_id}/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': current_user_uid || 'guest' },
            body: JSON.stringify({
                content: final_content,
                api_key: api_key,
                model: selected_model
            }),
            signal: abort_controller.signal
        });

        if (!res.ok) {
            const error_data = await res.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(error_data.detail || `Server Error (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let full_content = ''; // เนื้อหาผลลัพธ์สุทธิที่เราค่อยๆ พ่นลงจอ
        let raw_content_buffer = ''; // เนื้อหาดิบที่ได้รับจาก Network รอเข้าคิวพ่น
        let full_reasoning = '';
        let line_buffer = ''; // ✅ ตัวเก็บข้อมูลบรรทัดที่พ่นออกมาไม่ครบ (Chunk Fragmentation)
        
        // --- ระบบ Ticker (Smooth Streaming สไตล์ Gemini) ---
        let is_streaming_finished = false;
        const STREAM_SPEED_MS = 25; // ความเร็วในการพ่นตัวอักษรลงจอ (มิลลิวินาที)
        
        const display_ticker = setInterval(() => {
            if (raw_content_buffer.length > 0) {
                // ดึงตัวอักษรออกมา 1-3 ตัวต่อรอบ (ปรับให้ดูสมูทได้)
                // ถ้า buffer เยอะมาก ให้พ่นเร็วขึ้นเพื่อให้ UI ไม่ดีเลย์จนเกินไป
                const take_len = raw_content_buffer.length > 500 ? 10 : (raw_content_buffer.length > 100 ? 5 : 2);
                const chunk_to_display = raw_content_buffer.substring(0, take_len);
                raw_content_buffer = raw_content_buffer.substring(take_len);
                full_content += chunk_to_display;
                UpdateMessageContent(ai_message_container, full_content, full_reasoning);
                ScrollToBottom();
            } else if (is_streaming_finished) {
                clearInterval(display_ticker);
                // ปิดท้ายเพื่อให้แน่ใจว่า Render ตัวสุดท้ายครบถ้วน
                UpdateMessageContent(ai_message_container, full_content, full_reasoning);
            }
        }, STREAM_SPEED_MS);
        // ------------------------------------------------

        // เพิ่ม Cursor กระพริบเพื่อให้ดู "ไหล"
        if (ai_message_container && ai_message_container.contentDiv) {
            ai_message_container.contentDiv.classList.add('streaming-active');
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            line_buffer += decoder.decode(value, { stream: true });
            const lines = line_buffer.split('\n');
            line_buffer = lines.pop(); // ✅ เก็บส่วนที่ยังไม่จบบรรทัดไว้ใน buffer

            for (let line of lines) {
                const trimmed_line = line.trim();
                if (!trimmed_line || !trimmed_line.startsWith('data: ')) continue;

                const data_str = trimmed_line.replace('data: ', '').trim();
                if (data_str === '[DONE]') break;
                if (!data_str) continue;

                try {
                    const parsed = JSON.parse(data_str);
                    // รองรับทั้งเนื้อหาหลักและเนื้อหาการคิด (Reasoning)
                    if (parsed.reasoning_content !== undefined) {
                        full_reasoning += parsed.reasoning_content;
                        // Reasoning มักจะมาเร็ว เราพ่นลงจอตรงๆ ได้เลยเพื่อความพรีเมียม
                        UpdateMessageContent(ai_message_container, full_content, full_reasoning);
                    } else if (parsed.content !== undefined) {
                        // แทนที่จะ update ลงจอตรงๆ เราโยนใส่ Buffer เพื่อให้ Ticker พ่นอย่างนุ่มนวล
                        raw_content_buffer += parsed.content;
                    } else if (parsed.error) {
                        full_content += `\n**Error:** ${parsed.error}`;
                        UpdateMessageContent(ai_message_container, full_content, full_reasoning);
                    }
                } catch (e) {
                    console.warn('Failed to parse SSE data:', e);
                }
            }
            ScrollToBottom();
        }
        is_streaming_finished = true; // ✅ บอก Ticker ว่า Network จบแล้วนะ ให้เคลียร์ Buffer ที่เหลือ
    } catch (e) {
        if (e.name === 'AbortError') {
            // ผู้ใช้กดสตอป — พับ thought block ทันที
            console.log('Stream aborted');
            const tc = ai_message_container?.thoughtDiv?.parentElement;
            if (tc && !tc.classList.contains('collapsed')) {
                tc.classList.add('collapsed');
                const ch = tc.querySelector('.bulb');
                if (ch) ch.style.animation = 'none';
            }
        } else {
            console.error('Stream error:', e);
            const error_msg = `\n\n❌ **Error:** ${e.message || 'ไม่สามารถติดต่อ AI ได้ในขณะนี้'}`;
            // หากเกิด Error ระหว่างทาง และ message ถูกสร้างแล้ว
            if (typeof ai_message_container !== 'undefined') {
                UpdateMessageContent(ai_message_container, error_msg, "");
            } else {
                // หาก Error เกิดก่อน AppendMessage บังคับแจ้งเตือน User
                alert(error_msg.replace(/\*/g, ''));
            }
        }
    } finally {
        is_sending = false;
        action_btn.style.opacity = '1';
        
        if (typeof ai_message_container !== 'undefined' && ai_message_container.contentDiv) {
            ai_message_container.contentDiv.classList.remove('streaming-active');
        }
        
        is_streaming_finished = true; // มั่นใจอีกทีว่าหยุด Ticker
        
        // บังคับคืนค่าปุ่มทันที
        ResetToDefaultState();
        
        // หลังจาก Stream จบ ให้เปิดการแสดงผลปุ่ม Copy
        if (typeof ai_message_container !== 'undefined' && ai_message_container.contentDiv && ai_message_container.contentDiv.parentElement) {
            const action_row = ai_message_container.contentDiv.parentElement.querySelector('.message-actions');
            if (action_row) action_row.style.display = 'flex';
        }
        
        // พับ thought block หลัง stream จบ — แต่ต้องให้ user เห็นนานพอ
        if (typeof ai_message_container !== 'undefined' && ai_message_container.thoughtDiv) {
            const t_container = ai_message_container.thoughtDiv.parentElement;
            if (t_container) {
                const MIN_THOUGHT_DISPLAY_MS = 1500;
                const elapsed = ai_message_container.createdAt ? (Date.now() - ai_message_container.createdAt) : MIN_THOUGHT_DISPLAY_MS;
                const delay = Math.max(0, MIN_THOUGHT_DISPLAY_MS - elapsed);
                
                setTimeout(() => {
                    const bulb = t_container.querySelector('.bulb');
                    if (bulb) bulb.style.animation = 'none';
                    if (!t_container.classList.contains('collapsed')) {
                        t_container.classList.add('collapsed');
                        const chevron = t_container.querySelector('.chevron');
                        if (chevron) chevron.className = 'fa-solid fa-chevron-right chevron';
                    }
                }, delay);
            }
        }
        attached_files = []; // ล้างไฟล์แนบหลังส่ง
        RenderFilePreviews();
        FetchChats();
    }
}

// ===== UI Helpers =====

function SetStopMode(is_stop) {
    if (is_stop) {
        action_btn.classList.remove('send-mode');
        action_btn.classList.add('stop-mode');
        action_btn.disabled = false;
        action_btn.style.background = ''; // ใช้สีจาก CSS
        action_btn.style.color = '';      // ใช้สีจาก CSS
    } else {
        action_btn.classList.add('send-mode');
        action_btn.classList.remove('stop-mode');
        
        const has_text = message_input.value.trim().length > 0;
        
        if (has_text) {
            action_btn.disabled = false;
            action_btn.style.background = ''; // ใช้สีจาก CSS
            action_btn.style.color = '';      // ใช้สีจาก CSS
        } else {
            action_btn.disabled = true;
            action_btn.style.background = ''; // ใช้สีจาก CSS
            action_btn.style.color = '';      // ใช้สีจาก CSS
        }
    }
}

function ResetToDefaultState() {
    abort_controller = null;
    SetStopMode(false);
}

function UpdateLayoutState(is_new_chat) {
    if (!main_content) return;
    if (is_new_chat) {
        main_content.classList.add('centered-mode');
        // ✅ เพิ่มคลาสสำหรับจัดวางกึ่งกลาง
        main_content.classList.add('is-new-chat');
        if (!chat_container.contains(welcome_screen)) {
            chat_container.appendChild(welcome_screen);
        }
        welcome_screen.classList.remove('hidden');
    } else {
        main_content.classList.remove('centered-mode');
        // ✅ เอาคลาสออกเพื่อให้เลื่อนลงมาข้างล่าง
        main_content.classList.remove('is-new-chat');
        welcome_screen.classList.add('hidden');
    }
}

function ClearMessages() {
    chat_container.querySelectorAll('.message').forEach(el => el.remove());
}

function AppendMessage(role, content, is_empty_stream, model_name = null, files = []) {
    UpdateLayoutState(false);
    const now = Date.now();
    
    // จัดการการซ่อนข้อความ PDF (Parsing Content)
    const parsed_data = ParseMessageContent(content);
    const display_content = parsed_data.text;
    const extracted_files = parsed_data.files;

    // จัดการการดึงกระบวนการคิด (Thought Parsing) ออกจากเนื้อหาที่จะแสดงปกติ
    const thought_info = ParseThoughtPart(display_content);
    const final_display_content = thought_info.mainText;
    const initial_thought = thought_info.thoughtText;

    const div = document.createElement('div');
    div.className = `message ${role}`;
    const inner = document.createElement('div');
    inner.className = 'message-inner';

    let thought_body = null;
    let main_content_div = null;

    if (role === 'assistant') {
        const ai_avatar_div = document.createElement('div');
        ai_avatar_div.className = 'message-avatar ai-avatar';
        ai_avatar_div.style.flexShrink = '0';
        ai_avatar_div.innerHTML = `<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:var(--sidebar-bg);color:var(--text-color);font-size:18px;border-radius:50%;"><i class="fa-solid fa-robot"></i></div>`;
        inner.appendChild(ai_avatar_div);

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.gap = '8px';
        wrapper.style.width = '100%';

        // 1. ส่วนแสดงไฟล์แนบ (ย้ายมาไว้ข้างบนสุด)
        const all_files = [...files, ...extracted_files];
        if (all_files.length > 0) {
            const attachment_row = document.createElement('div');
            attachment_row.className = 'message-attachments';
            all_files.forEach(file => {
                const pill = document.createElement('div');
                pill.className = `message-file-pill ${file.type === 'application/pdf' ? 'pdf-type' : ''}`;
                const icon = document.createElement('i');
                icon.className = file.type === 'application/pdf' ? 'fa-solid fa-file-pdf' : 'fa-regular fa-file-lines';
                pill.appendChild(icon);
                const name_text = document.createElement('div');
                name_text.className = 'file-name';
                name_text.textContent = file.name;
                pill.appendChild(name_text);
                attachment_row.appendChild(pill);
            });
            wrapper.appendChild(attachment_row);
        }

        // 2. ส่วนของ Thought (ความเห็นของ AI)
        if (initial_thought || is_empty_stream) {
            const t = CreateThoughtBlock();
            wrapper.appendChild(t.container);
            thought_body = t.body;
            if (initial_thought) {
                // โมเดลที่มี reasoning จริง (โหลดจากประวัติ) → พับไว้
                thought_body.innerText = initial_thought;
                t.container.classList.add('collapsed');
                const chevron = t.container.querySelector('.chevron');
                if (chevron) chevron.className = 'fa-solid fa-chevron-right chevron';
            } else {
                // กำลัง stream อยู่ (ทุกโมเดล) → แสดงเปิดไว้เสมอ และ pulse ไอคอน lightbulb
                t.container.classList.remove('collapsed');
                const bulb = t.container.querySelector('.bulb');
                if (bulb) bulb.style.animation = 'pulse-bulb 1.2s ease-in-out infinite';
            }
        }

        // 3. ส่วนเนื้อหาข้อความ
        main_content_div = document.createElement('div');
        main_content_div.className = 'message-content';
        if (!is_empty_stream) {
            const text_to_render = final_display_content || " ";
            main_content_div.dataset.markdown = text_to_render;
            UpdateContentHtml(main_content_div, text_to_render);
        }
        wrapper.appendChild(main_content_div);

        const action_row = document.createElement('div');
        action_row.className = 'message-actions';
        if (is_empty_stream) {
            action_row.style.display = 'none';
        }
        action_row.innerHTML = `
            <button class="copy-message-btn" title="Copy">
                <i class="fa-regular fa-copy"></i>
            </button>
        `;
        const copy_btn = action_row.querySelector('.copy-message-btn');
        copy_btn.onclick = () => {
            const raw_content = main_content_div.dataset.markdown || main_content_div.innerText;
            navigator.clipboard.writeText(raw_content).then(() => {
                const icon = copy_btn.querySelector('i');
                icon.className = 'fa-solid fa-check';
                setTimeout(() => { icon.className = 'fa-regular fa-copy'; }, 2000);
            });
        };
        wrapper.appendChild(action_row);
        inner.appendChild(wrapper);
    } else {
        // ส่วนรของผู้ใช้ (User)
        const user_wrapper = document.createElement('div');
        user_wrapper.className = 'user-message-wrapper';
        user_wrapper.style.display = 'flex';
        user_wrapper.style.flexDirection = 'column';
        user_wrapper.style.alignItems = 'flex-end';
        user_wrapper.style.gap = '8px';

        // 1. ไฟล์แนบของผู้ใช้ (อยู่ด้านบน)
        if (files.length > 0) {
            const attachment_row = document.createElement('div');
            attachment_row.className = 'message-attachments';
            files.forEach(file => {
                const pill = document.createElement('div');
                pill.className = `message-file-pill ${file.type === 'application/pdf' ? 'pdf-type' : ''}`;
                const icon = document.createElement('i');
                icon.className = file.type === 'application/pdf' ? 'fa-solid fa-file-pdf' : 'fa-regular fa-file-lines';
                pill.appendChild(icon);
                const name_text = document.createElement('div');
                name_text.className = 'file-name';
                name_text.textContent = file.name;
                pill.appendChild(name_text);
                attachment_row.appendChild(pill);
            });
            user_wrapper.appendChild(attachment_row);
        }

        // 2. เนื้อหาข้อความของผู้ใช้
        main_content_div = document.createElement('div');
        main_content_div.className = 'message-content';
        if (!is_empty_stream) {
            const user_content = display_content || " ";
            main_content_div.dataset.markdown = user_content;
            UpdateContentHtml(main_content_div, user_content);
        }
        user_wrapper.appendChild(main_content_div);
        inner.appendChild(user_wrapper);
    }

    div.appendChild(inner);
    chat_container.appendChild(div);
    if (!is_empty_stream && main_content_div) RenderMath(main_content_div);
    ScrollToBottom();

    // คืนค่าทั้ง 2 ส่วนเผื่อการอัปเดตแบบ Stream และเก็บเวลาที่สร้างไว้
    return { content_div: main_content_div, thought_div: thought_body, created_at: now };
}

function UpdateMessageContent(elements_obj, raw_markdown_content, explicit_reasoning = "") {
    if (!elements_obj) return;
    const { content_div, thought_div } = elements_obj;
    
    // 1. จัดการข้อมูลการคิด (Thought/Reasoning)
    let final_thought_text = explicit_reasoning;
    let main_text = raw_markdown_content;

    // ถ้าไม่มีข้อมูลการคิดส่งแยกมา ให้ลองแกะจากเนื้อหาหลัก (Fallback)
    if (!final_thought_text) {
        const thought_info = ParseThoughtPart(raw_markdown_content);
        main_text = thought_info.main_text;
        final_thought_text = thought_info.thought_text;
    }

    if (final_thought_text && thought_div) {
        thought_div.innerText = final_thought_text;
        const container = thought_div.parentElement;
        if (container) {
            container.style.display = 'block';
            container.classList.remove('hidden');
            
            // ✅ พับเก็บอัตโนมัติถ้าเริ่มแสดงเนื้อหาหลักแล้ว (สไตล์ Gemini)
            if (main_text.trim().length > 0) {
                if (!container.classList.contains('collapsed')) {
                    container.classList.add('collapsed');
                    const chevron = container.querySelector('.chevron');
                    if (chevron) chevron.className = 'fa-solid fa-chevron-right chevron';
                    const bulb = container.querySelector('.bulb');
                    if (bulb) bulb.style.animation = 'none';
                }
            } else {
                // กางไว้ระหว่างที่ยังไม่มีเนื้อหาหลักพ่นออกมา
                container.classList.remove('collapsed');
            }
        }
    } else if (thought_div && !final_thought_text) {
        // ไม่มี reasoning จริงๆ (เช่น Gemini Flash) — แสดง thought block ค้างไว้ตลอดระหว่าง stream
        // ให้ "Thought for a moment" โชว์ตลอดขณะที่กำลังตอบ
        // การซ่อน/พับจะเกิดขึ้นใน finally block หลัง stream จบ เท่านั้น
        const container = thought_div.parentElement;
        if (container) {
            container.style.display = 'block';
            // ✅ พับเก็บอัตโนมัติถ้าเริ่มแสดงเนื้อหาหลักแล้ว
            if (main_text.trim().length > 0) {
                if (!container.classList.contains('collapsed')) {
                    container.classList.add('collapsed');
                    const chevron = container.querySelector('.chevron');
                    if (chevron) chevron.className = 'fa-solid fa-chevron-right chevron';
                    const bulb = container.querySelector('.bulb');
                    if (bulb) bulb.style.animation = 'none';
                }
            } else {
                container.classList.remove('collapsed');
            }
        }
    }

    // 2. อัปเดตเนื้อหาหลัก
    if (content_div) {
        content_div.dataset.markdown = main_text;
        UpdateContentHtml(content_div, main_text);
        RenderMath(content_div);
    }
}

function UpdateContentHtml(element, markdown_content) {
    let math_blocks = [];
    let text = markdown_content;
    function StashMath(regex) {
        text = text.replace(regex, (match) => {
            const id = `%%%MATH_${math_blocks.length}%%%`;
            math_blocks.push(match);
            return id;
        });
    }
    StashMath(/\\\[[\s\S]*?\\\]/g);
    StashMath(/\\\([\s\S]*?\\\)/g);
    StashMath(/\$\$[\s\S]*?\$\$/g);
    StashMath(/(?<!\$)\$[^\$]+\$(?!\$)/g);
    let html = marked.parse(text);
    math_blocks.forEach((block, i) => {
        const id = `%%%MATH_${i}%%%`;
        html = html.replace(id, () => block);
    });
    element.innerHTML = html;
}

function RenderMath(element) {
    if (typeof renderMathInElement === 'function') {
        renderMathInElement(element, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false }
            ],
            throwOnError: false
        });
    } else {
        console.warn('⚠️ KaTeX renderMathInElement is not available.');
    }
}

function ScrollToBottom() {
    // ✅ ถ้าผู้ใช้เลื่อนขึ้นไปอ่านข้อความเก่า (is_auto_scroll_enabled = false) ไม่ต้องดึงหน้าจอลงมา
    if (!is_auto_scroll_enabled) return;
    chat_container.scrollTop = chat_container.scrollHeight;
}

// ===== จัดการไฟล์แนบ (File Attachment Helpers) =====

function HandleFileSelect(event) {
    const files = Array.from(event.target.files);
    files.forEach(async file => {
        const file_obj = {
            file: file,
            name: file.name,
            type: file.type,
            extracted_text: ""
        };

        if (file.type === 'application/pdf') {
            file_obj.extracted_text = await ExtractTextFromPDF(file);
        }
        
        attached_files.push(file_obj);
        RenderFilePreviews();
    });
    file_input.value = ''; // Reset
}

async function ExtractTextFromPDF(file) {
    try {
        const array_buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: array_buffer }).promise;
        let full_text = "";
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const text_content = await page.getTextContent();
            const page_text = text_content.items.map(item => item.str).join(" ");
            full_text += page_text + "\n";
        }
        return full_text;
    } catch (e) {
        console.error("PDF Extraction Error:", e);
        return "[Error extracting text from PDF]";
    }
}

function RenderFilePreviews() {
    file_preview_container.innerHTML = '';
    if (attached_files.length === 0) {
        file_preview_container.style.display = 'none';
        return;
    }

    file_preview_container.style.display = 'flex';
    attached_files.forEach((file, index) => {
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

        const name_span = document.createElement('span');
        name_span.textContent = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;
        pill.appendChild(name_span);

        const remove_btn = document.createElement('div');
        remove_btn.className = 'remove-file';
        remove_btn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        remove_btn.onclick = () => RemoveFile(index);
        pill.appendChild(remove_btn);

        file_preview_container.appendChild(pill);
    });
}

function RemoveFile(index) {
    attached_files.splice(index, 1);
    RenderFilePreviews();
}

// ===== ฟังก์ชันสำหรับตรวจจับและซ่อนข้อมูล PDF ในแชท (Content Parser) =====

function ParseMessageContent(raw_content) {
    if (!raw_content || typeof raw_content !== 'string') return { text: raw_content, files: [] };

    const TAG = "[เอกสารแนบเพื่ออ้างอิงและสรุป]";
    if (!raw_content.includes(TAG)) return { text: raw_content, files: [] };

    let text = raw_content;
    let files = [];

    // ดึงข้อมูลชื่อไฟล์ PDF ออกมา (Regex สำหรับดึงระหว่าง --- ข้อมูลจากไฟล์ PDF: และ ---)
    const name_regex = /--- ข้อมูลจากไฟล์ PDF: (.*?) ---/g;
    let match;
    while ((match = name_regex.exec(raw_content)) !== null) {
        files.push({ name: match[1], type: 'application/pdf' });
    }

    // ตัดส่วน Context ทิ้ง เหลือแต่คำสั่งจากผู้ใช้จริงๆ
    const user_prompt_regex = /\[คำสั่งจากผู้ใช้\]: ([\s\S]*)$/;
    const content_match = raw_content.match(user_prompt_regex);
    if (content_match) {
        text = content_match[1].trim();
    } else {
        // กรณีหาแท็กปิดไม่เจอ ให้ตัดเอาแค่ส่วนสุดท้ายหรือส่วนที่เป็น User text
        text = raw_content.split(TAG).pop().trim();
    }

    return { text, files };
}

// ===== ผู้ช่วยตรวจจับกระบวนการคิด (Thought Parser) =====
function ParseThoughtPart(content) {
    if (!content) return { main_text: "", thought_text: "" };

    // รูปแบบหลัก: <thought>เนื้อหา</thought>
    const thought_regex = /<thought>([\s\S]*?)<\/thought>/;
    const match = content.match(thought_regex);

    if (match) {
        const thought_text = match[1].trim();
        const main_text = content.replace(thought_regex, "").trim();
        return { main_text: main_text, thought_text: thought_text };
    }

    // กรณีโมเดลกำลัง Stream และยังไม่มีปิดแท็ก
    if (content.includes("<thought>")) {
        const parts = content.split("<thought>");
        return { 
            main_text: parts[0]?.trim() || "", 
            thought_text: parts[1]?.trim() || "" 
        };
    }

    return { main_text: content, thought_text: "" };
}

function CreateThoughtBlock() {
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
