document.addEventListener('DOMContentLoaded', () => {
    const chatWindow = document.getElementById('chatWindow');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const thinkingButton = document.getElementById('thinkingButton'); 
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const thinkingModeIndicator = document.getElementById('thinkingModeIndicator');
    const inputArea = document.getElementById('inputArea'); 
    const uploadedFilesContainer = document.getElementById('uploadedFilesContainer');

    let isThinkingModeEnabled = localStorage.getItem('isThinkingModeEnabled') === 'true'; 
    let uploadedFiles = []; 

    const addMessage = (message, sender) => {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('chat-message', `${sender}-message`);
        
        if (sender === 'bot') {
            const formattedMessage = message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            messageDiv.innerHTML = formattedMessage.replace(/\n/g, '<br>');
        } else {
            messageDiv.innerHTML = message.replace(/\n/g, '<br>');
        }
        
        chatWindow.appendChild(messageDiv);
        chatWindow.scrollTop = chatWindow.scrollHeight;

        if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
            MathJax.typesetPromise([messageDiv]).catch((err) => console.error("MathJax typesetting failed:", err));
        }
    };

    const updateThinkingModeUI = () => {
        if (isThinkingModeEnabled) {
            thinkingButton.classList.add('thinking-on'); 
            thinkingModeIndicator.classList.remove('hidden'); 
        } else {
            thinkingButton.classList.remove('thinking-on'); 
            thinkingModeIndicator.classList.add('hidden'); 
        }
    };

    const toggleThinkingMode = () => {
        isThinkingModeEnabled = !isThinkingModeEnabled;
        localStorage.setItem('isThinkingModeEnabled', isThinkingModeEnabled); 
        updateThinkingModeUI(); 
        console.log(`Thinking Mode: ${isThinkingModeEnabled ? 'BẬT' : 'TẮT'}`);
    };

    const displayUploadedFile = (file) => {
        const fileTag = document.createElement('div');
        fileTag.classList.add('uploaded-file-tag');
        
        let iconClass = 'fas fa-file'; 
        if (file.type.includes('text/plain')) {
            iconClass = 'fas fa-file-alt'; 
        } else if (file.type.includes('application/pdf')) {
            iconClass = 'fas fa-file-pdf'; 
        } else if (file.type.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
            iconClass = 'fas fa-file-word'; 
        }

        fileTag.innerHTML = `
            <i class="${iconClass} file-icon"></i>
            <span>${file.name}</span>
            <button class="remove-file-button"><i class="fas fa-times-circle"></i></button>
        `;

        const removeButton = fileTag.querySelector('.remove-file-button');
        removeButton.addEventListener('click', () => {
            removeUploadedFile(file);
        });

        uploadedFilesContainer.appendChild(fileTag);
        uploadedFilesContainer.classList.remove('hidden'); 
    };

    const removeUploadedFile = (fileToRemove) => {
        uploadedFiles = uploadedFiles.filter(file => file !== fileToRemove);
        renderUploadedFiles(); 
    };

    const renderUploadedFiles = () => {
        uploadedFilesContainer.innerHTML = ''; 
        if (uploadedFiles.length === 0) {
            uploadedFilesContainer.classList.add('hidden'); 
        } else {
            uploadedFiles.forEach(file => displayUploadedFile(file));
        }
    };

    // REVISED Send Message Function
    const sendMessage = async () => {
        const message = userInput.value.trim();
        if (!message && uploadedFiles.length === 0) return; 

        addMessage(message, 'user');
        userInput.value = '';
        userInput.style.height = 'auto'; 

        // Cập nhật thông báo loading dựa trên Thinking Mode
        loadingDiv.querySelector('span').textContent = isThinkingModeEnabled ? 'Rosk đang suy nghĩ sâu...' : 'Rosk đang suy nghĩ...';
        loadingDiv.classList.remove('hidden');
        errorDiv.classList.add('hidden'); 
        
        const formData = new FormData();
        formData.append('message', message);
        // Quan trọng: Gửi trạng thái thinkingMode hiện tại từ frontend
        formData.append('thinkingMode', isThinkingModeEnabled); 

        uploadedFiles.forEach((file) => {
            formData.append('files', file); 
        });

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                body: formData 
            });

            const data = await response.json();

            if (response.ok) {
                let botResponse = data.response;
                addMessage(botResponse, 'bot'); 
                uploadedFiles = []; 
                renderUploadedFiles(); 
            } else {
                errorDiv.textContent = data.error || 'Có lỗi xảy ra trong quá trình xử lý. Vui lòng thử lại.';
                errorDiv.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Lỗi khi gửi yêu cầu:', err);
            errorDiv.textContent = 'Không thể kết nối đến Rosk AI. Vui lòng kiểm tra kết nối internet hoặc thử lại sau.';
            errorDiv.classList.remove('hidden');
        } finally {
            loadingDiv.classList.add('hidden');
        }
    };

    // Drag & Drop Event Listeners 
    inputArea.addEventListener('dragover', (e) => {
        e.preventDefault(); 
        inputArea.classList.add('drag-over'); 
    });

    inputArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        inputArea.classList.remove('drag-over'); 
    });

    inputArea.addEventListener('drop', async (e) => {
        e.preventDefault(); 
        inputArea.classList.remove('drag-over'); 
        
        const files = e.dataTransfer.files;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileExtension = file.name.split('.').pop().toLowerCase();
            const allowedMimeTypes = [
                'text/plain', 
                'application/pdf', 
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
            ];

            if (allowedMimeTypes.includes(file.type) || (fileExtension === 'docx' && !file.type)) { 
                if (!uploadedFiles.some(f => f.name === file.name && f.size === file.size)) {
                    uploadedFiles.push(file);
                }
            } else {
                alert(`File "${file.name}" (${file.type || fileExtension}) có định dạng không được hỗ trợ. Vui lòng chỉ kéo thả .txt, .pdf, hoặc .docx.`);
            }
        }
        renderUploadedFiles(); 
    });

    // Other Event Listeners 
    sendButton.addEventListener('click', sendMessage);

    userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) { 
            event.preventDefault(); 
            sendMessage();
        }
    });

    userInput.addEventListener('input', () => {
        userInput.style.height = 'auto';
        userInput.style.height = userInput.scrollHeight + 'px';
    });

    thinkingButton.addEventListener('click', (event) => {
        event.stopPropagation(); 
        toggleThinkingMode();
    });

    updateThinkingModeUI();
    renderUploadedFiles(); 
});
