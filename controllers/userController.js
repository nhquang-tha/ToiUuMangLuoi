<%- include('partials/head') %>
<%
    // THUẬT TOÁN QUÉT BIẾN ĐA NĂNG: Tìm kiếm thông tin user ở mọi biến khả thi từ Controller truyền sang
    let activeUser = null;
    if (typeof currentUser !== 'undefined' && currentUser != null) {
        activeUser = currentUser;
    } else if (typeof user !== 'undefined' && user != null) {
        activeUser = user;
    } else if (locals.currentUser != null) {
        activeUser = locals.currentUser;
    } else if (locals.user != null) {
        activeUser = locals.user;
    }
    
    // Lấy quyền hạn gốc từ Database
    let rawRole = activeUser && activeUser.role ? activeUser.role : '';
    
    // Chuẩn hóa quyền hạn (viết thường, xóa khoảng trắng)
    let normalizedRole = rawRole ? String(rawRole).trim().toLowerCase() : '';
    
    // Kiểm tra xem Database có đang lưu chuẩn xác 100% chữ 'admin' không
    let isExactAdmin = rawRole === 'admin';
    
    // Nếu Database lưu sai định dạng (vd: 'Admin', 'admin ') thì cảnh báo
    let isMalformedAdmin = !isExactAdmin && normalizedRole === 'admin';
    
    // Tạo một bản sao của User để truyền vào Sidebar giúp Sidebar luôn nhận diện đúng
    let sidebarUser = activeUser ? Object.assign({}, activeUser, { role: normalizedRole }) : null;
%>
<style>
    .layout { display: flex; height: 100vh; overflow: hidden; background-color: #f4f6f8; }
    .main-content { flex: 1; overflow-y: auto; padding: 20px; }
</style>
<div class="layout">
    <!-- Truyền user đã chuẩn hóa vào Sidebar để Menu luôn hiện -->
    <%- include('partials/sidebar', { currentUser: sidebarUser }) %>
    <main class="main-content">
        <header class="topbar">
            <h1>Đổi Mật Khẩu (Profile)</h1>
        </header>
        <div class="content-body">
            <div class="card" style="max-width: 550px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                
                <!-- BỘ CHẨN ĐOÁN LỖI MẤT KẾT NỐI SESSION (Backend không truyền dữ liệu) -->
                <% if (!activeUser) { %>
                    <div class="alert alert-danger" style="padding:15px; background:#f8d7da; color:#721c24; margin-bottom:20px; border-radius:4px; border: 2px solid #c0392b;">
                        <strong style="font-size: 15px;">⚠️ LỖI KHÔNG NHẬN ĐƯỢC DỮ LIỆU TỪ BACKEND:</strong><br><br>
                        Dữ liệu 'admin' trong Database của bạn đã <b>chuẩn xác</b>. Nhưng giao diện báo "Chưa xác định" vì Giao diện đang không nhận được thông tin tài khoản từ Controller truyền sang.<br><br>
                        <b>Cách khắc phục:</b> Hãy mở file <code>controllers/userController.js</code>, tìm hàm <code>getProfilePage</code>. Bạn hãy sửa biến truyền vào thành đúng biến chứa Session hoặc Token của dự án bạn nhé:<br>
                        <code style="display:block; background:#fff; padding:10px; margin-top:10px; border:1px solid #f5c6cb; color:#c0392b; font-weight:bold; word-break: break-all;">
                            exports.getProfilePage = (req, res) => {<br>
                            &nbsp;&nbsp;&nbsp;&nbsp;res.render('profile', { <br>
                            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;title: 'Profile', <br>
                            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;page: 'Profile', <br>
                            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;user: req.user // Hoặc req.session.user, tùy theo authMiddleware của bạn đang dùng<br>
                            &nbsp;&nbsp;&nbsp;&nbsp;});<br>
                            };
                        </code>
                    </div>
                <% } else { %>
                    <!-- Khung hiển thị quyền hạn để User tự kiểm tra -->
                    <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #3498db;">
                        <p style="margin: 0 0 5px 0; font-size: 14px;"><strong>Tài khoản:</strong> <%= activeUser.username || 'N/A' %></p>
                        <p style="margin: 0; font-size: 14px;"><strong>Quyền hạn Database (Giá trị gốc):</strong> 
                            <span style="color: <%= isExactAdmin ? '#27ae60' : '#e74c3c' %>; font-weight: bold; font-family: monospace; font-size: 16px;">
                                '<%= rawRole %>'
                            </span>
                        </p>
                    </div>
                <% } %>

                <!-- CẢNH BÁO NẾU DATABASE SAI ĐỊNH DẠNG (Có khoảng trắng, viết hoa) -->
                <% if (isMalformedAdmin) { %>
                    <div class="alert alert-danger" style="padding:15px; background:#f8d7da; color:#721c24; margin-bottom:20px; border-radius:4px; border: 2px solid #c0392b;">
                        <strong style="font-size: 15px;">⚠️ CẢNH BÁO LỖI PHÂN QUYỀN TRONG DATABASE:</strong><br><br>
                        Hệ thống phát hiện quyền của bạn trong Database đang bị sai định dạng (hiện đang là giá trị <b>'<%= rawRole %>'</b>). Nó có thể đang bị viết hoa hoặc bị thừa khoảng trắng.<br><br>
                        Node.js Backend yêu cầu quyền quản trị phải chính xác tuyệt đối là chữ <b>'admin'</b>.<br><br>
                        <b>Cách khắc phục:</b> Hãy mở phần mềm quản lý Database (TiDB/DBeaver) và chạy lệnh SQL này để ép chuẩn hóa lại quyền:<br>
                        <code style="display:block; background:#fff; padding:10px; margin-top:10px; border:1px solid #f5c6cb; color:#c0392b; font-weight:bold; word-break: break-all;">
                            UPDATE users SET role = 'admin' WHERE username = '<%= activeUser ? activeUser.username : '' %>';
                        </code>
                        <i style="display:block; margin-top:8px; font-size:12px; color: #721c24;">* Lưu ý: Sau khi chạy lệnh SQL xong, bạn PHẢI Đăng xuất và Đăng nhập lại nhé!</i>
                    </div>
                <% } %>

                <% if(locals.message) { %> 
                    <div class="alert alert-success" style="padding:10px; background:#d4edda; color:#155724; margin-bottom:15px; border-radius:4px; border: 1px solid #c3e6cb;"><%= message %></div> 
                <% } %>
                
                <% if(locals.error) { %> 
                    <div class="alert alert-danger" style="padding:10px; background:#f8d7da; color:#721c24; margin-bottom:15px; border-radius:4px; border: 1px solid #f5c6cb;"><%= error %></div> 
                <% } %>
                
                <form action="/system/profile/change-password" method="POST">
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label style="display:block; margin-bottom:8px; font-weight:bold; color:#2c3e50;">Mật khẩu hiện tại:</label>
                        <input type="password" name="currentPassword" required style="width: 100%; padding: 10px; border: 1px solid #bdc3c7; border-radius: 4px; outline: none;">
                    </div>
                    <div class="form-group" style="margin-bottom: 15px;">
                        <label style="display:block; margin-bottom:8px; font-weight:bold; color:#2c3e50;">Mật khẩu mới:</label>
                        <input type="password" name="newPassword" required style="width: 100%; padding: 10px; border: 1px solid #bdc3c7; border-radius: 4px; outline: none;">
                    </div>
                    <div class="form-group" style="margin-bottom: 25px;">
                        <label style="display:block; margin-bottom:8px; font-weight:bold; color:#2c3e50;">Xác nhận mật khẩu mới:</label>
                        <input type="password" name="confirmPassword" required style="width: 100%; padding: 10px; border: 1px solid #bdc3c7; border-radius: 4px; outline: none;">
                    </div>
                    <button type="submit" class="btn-primary" style="width: 100%; padding: 12px; background: #2980b9; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 15px;">Cập Nhật Mật Khẩu</button>
                </form>
            </div>
        </div>
    </main>
</div>
</body>
</html>
