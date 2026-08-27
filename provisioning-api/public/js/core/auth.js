/**
 * ==============================================================================
 * MODULE CORE 3: AUTHENTICATION & ROUTE GUARD (auth.js)
 * ==============================================================================
 * Mục đích:
 *  - Quản lý JWT Token và phiên đăng nhập người dùng (Admin / Pilot).
 *  - Bảo vệ toàn bộ giao diện Frontend: Khách chưa đăng nhập CHỈ xem được trang Đăng nhập / Đăng ký.
 *  - Tự động đính kèm Authorization Header cho mọi request API & WebSocket.
 *  - Khởi tạo & Dọn dẹp luồng dữ liệu Dashboard khi Đăng nhập / Đăng xuất.
 * ==============================================================================
 */

const AUTH_STORAGE_KEY = 'sb_auth_token';
const USER_STORAGE_KEY = 'sb_auth_user';

function getAuthToken() {
  return localStorage.getItem(AUTH_STORAGE_KEY) || '';
}

function getAuthUser() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function setAuthSession(token, user) {
  localStorage.setItem(AUTH_STORAGE_KEY, token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
  if (typeof disconnectWebSocket === 'function') {
    disconnectWebSocket();
  }
}

/**
 * Fetch bọc ngoài tự động gắn JWT Token và kiểm tra 401 (Hết hạn phiên)
 */
async function authFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = {
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      console.warn('[Auth Guard] Phiên đăng nhập hết hạn hoặc chưa xác thực (401). Chuyển về màn hình đăng nhập.');
      clearAuthSession();
      showAuthScreen('login');
    }

    return response;
  } catch (err) {
    console.error(`[AuthFetch] Lỗi kết nối API ${url}:`, err);
    throw err;
  }
}

/**
 * Cập nhật Widget thông tin người dùng trên Navbar
 */
function updateUserProfileUI(user) {
  const profileWidget = document.getElementById('user-profile-widget');
  const adminTabs = document.querySelectorAll('.admin-only-tab');

  if (!profileWidget) return;

  if (user) {
    const isRoleAdmin = user.role === 'ADMIN';
    const roleBadgeColor = isRoleAdmin 
      ? 'background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);' 
      : 'background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4);';

    profileWidget.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.65rem; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.12); padding: 0.35rem 0.75rem; border-radius: 8px;">
        <div style="width: 28px; height: 28px; border-radius: 50%; background: ${isRoleAdmin ? '#d97706' : '#0284c7'}; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 800; color: #fff;">
          ${user.fullName ? user.fullName.charAt(0).toUpperCase() : 'U'}
        </div>
        <div style="display: flex; flex-direction: column; text-align: left; line-height: 1.15;">
          <span style="font-size: 0.8rem; font-weight: 700; color: #f1f5f9;">${user.fullName || user.email}</span>
          <span style="font-size: 0.68rem; color: #94a3b8;">${user.email}</span>
        </div>
        <span style="font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.5px; ${roleBadgeColor}">
          ${user.role}
        </span>
        <button onclick="handleLogout()" title="Đăng xuất khỏi hệ thống" style="background: none; border: none; color: #94a3b8; cursor: pointer; padding: 0.2rem 0.4rem; font-size: 0.85rem; margin-left: 0.2rem;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#94a3b8'">
          <i class="fa-solid fa-right-from-bracket"></i>
        </button>
      </div>
    `;

    // Ẩn/Hiện các tab chỉ dành riêng cho Admin
    adminTabs.forEach(el => {
      el.style.display = isRoleAdmin ? '' : 'none';
    });
  } else {
    profileWidget.innerHTML = '';
    adminTabs.forEach(el => {
      el.style.display = 'none';
    });
  }
}

/**
 * Hiển thị màn hình Đăng nhập / Đăng ký (Khóa toàn bộ Dashboard)
 */
function showAuthScreen(mode = 'login') {
  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');
  const loginForm = document.getElementById('auth-login-form');
  const registerForm = document.getElementById('auth-register-form');
  const tabLogin = document.getElementById('tab-btn-login');
  const tabRegister = document.getElementById('tab-btn-register');

  if (authScreen) authScreen.style.display = 'flex';
  if (appScreen) appScreen.style.display = 'none';

  if (mode === 'login') {
    if (loginForm) loginForm.style.display = 'block';
    if (registerForm) registerForm.style.display = 'none';
    if (tabLogin) tabLogin.classList.add('active');
    if (tabRegister) tabRegister.classList.remove('active');
  } else {
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'block';
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabRegister) tabRegister.classList.add('active');
  }
}

/**
 * Mở khóa và hiển thị toàn bộ Dashboard Tác chiến sau khi xác thực thành công
 */
function showAppScreen(user) {
  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');

  if (authScreen) authScreen.style.display = 'none';
  if (appScreen) appScreen.style.display = 'block';

  updateUserProfileUI(user);

  // Khởi động toàn bộ các thành phần Dashboard
  if (typeof window.initDashboardApp === 'function') {
    window.initDashboardApp();
  }
}

/**
 * Xử lý Đăng nhập
 */
async function handleLoginSubmit(e) {
  e.preventDefault();
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const errorMsg = document.getElementById('login-error-msg');
  const submitBtn = document.getElementById('login-submit-btn');

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  errorMsg.style.display = 'none';
  errorMsg.innerText = '';
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang xác thực...';

  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Email hoặc mật khẩu không chính xác');
    }

    setAuthSession(data.accessToken, data.user);
    showAppScreen(data.user);
  } catch (err) {
    errorMsg.innerText = `⚠️ ${err.message}`;
    errorMsg.style.display = 'flex';
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Đăng Nhập Hệ Thống';
  }
}

/**
 * Xử lý Đăng ký tài khoản Phi công
 */
async function handleRegisterSubmit(e) {
  e.preventDefault();
  const fullName = document.getElementById('reg-fullname').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errorMsg = document.getElementById('register-error-msg');
  const submitBtn = document.getElementById('register-submit-btn');

  errorMsg.style.display = 'none';
  errorMsg.innerText = '';
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang khởi tạo...';

  try {
    const res = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Đăng ký không thành công');
    }

    setAuthSession(data.accessToken, data.user);
    showAppScreen(data.user);
  } catch (err) {
    errorMsg.innerText = `⚠️ ${err.message}`;
    errorMsg.style.display = 'flex';
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Hoàn Tất Đăng Ký';
  }
}

/**
 * Điền nhanh tài khoản Admin mặc định
 */
function fillAdminDemoAccount() {
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  if (emailInput && passwordInput) {
    emailInput.value = 'admin@gmail.com';
    passwordInput.value = 'admin';
    showAuthScreen('login');
  }
}

/**
 * Xử lý Đăng xuất
 */
function handleLogout() {
  if (confirm('Bạn có chắc chắn muốn đăng xuất khỏi Cockpit?')) {
    clearAuthSession();
    showAuthScreen('login');
  }
}

/**
 * BẢO VỆ ROUTE KHI TẢI TRANG (FRONTEND ROUTE GUARD)
 */
document.addEventListener('DOMContentLoaded', async () => {
  const token = getAuthToken();
  const cachedUser = getAuthUser();

  if (token && cachedUser) {
    // Thử xác thực lại với server để đảm bảo token còn hạn
    try {
      const res = await fetch('/api/v1/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        setAuthSession(token, data.user || cachedUser);
        showAppScreen(data.user || cachedUser);
        return;
      }
    } catch (e) {
      // Bỏ qua lỗi mạng tạm thời và dùng cache nếu có
      showAppScreen(cachedUser);
      return;
    }
  }

  // Khách chưa đăng nhập: Hiển thị duy nhất màn hình Đăng nhập / Đăng ký
  clearAuthSession();
  showAuthScreen('login');
});
