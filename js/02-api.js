// ==========================================
        // 第2批移植：API配置系统
        // ==========================================
        
        async function initApiConfig() {
            // 从本地存储加载API配置
            await loadFromLocal();
            
            // 同步到输入框
            const apiKeyInput = document.getElementById('api-key-input');
            const apiUrlInput = document.getElementById('api-url-input');
            
            if (apiKeyInput) {
                apiKeyInput.value = APP_DATA.apiKey || '';
                // 监听输入变化，自动保存
                apiKeyInput.addEventListener('input', () => {
                    APP_DATA.apiKey = apiKeyInput.value.trim();
                    saveToLocal();
                });
            }
            
            if (apiUrlInput) {
                apiUrlInput.value = APP_DATA.apiUrl || 'https://api.openai.com/v1/chat/completions';
                apiUrlInput.addEventListener('input', () => {
                    APP_DATA.apiUrl = apiUrlInput.value.trim() || 'https://api.openai.com/v1/chat/completions';
                    saveToLocal();
                });
            }
        }
        
        // --- 验证API配置 ---
        function validateApiConfig() {
            if (!APP_DATA.apiKey) {
                alert('请先在"我"页面配置API密钥');
                return false;
            }
            return true;
        }
