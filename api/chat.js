// Thay đổi từ server.js
// Vị trí mới: project_root/api/chat.js

require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const multer = require('multer');
const pdf = require('pdf-parse');
const stream = require('stream');
const unzipper = require('unzipper');

const app = express();
// Dòng này (port) không cần thiết cho Vercel nữa vì Vercel tự quản lý cổng
// const port = process.env.PORT || 3000; 

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash-lite';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
            'text/plain',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/zip' // Lưu ý: fileFilter của bạn cho phép zip, nhưng logic đọc file chỉ xử lý txt, pdf, docx
        ];
        if (allowedMimeTypes.includes(file.mimetype) ||
            file.originalname.toLowerCase().endsWith('.txt') ||
            file.originalname.toLowerCase().endsWith('.pdf') ||
            file.originalname.toLowerCase().endsWith('.docx')
        ) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file type! Only .txt, .pdf, and .docx are allowed.'), false);
        }
    }
});

app.use(express.json());
// Vercel sẽ phục vụ các file tĩnh từ thư mục 'public' tự động,
// nhưng route này vẫn có thể được giữ nếu bạn muốn xử lý nó một cách cụ thể thông qua Express
// Tuy nhiên, với Vercel, tốt nhất là để Vercel tự động serve static assets.
// Nếu bạn có file index.html trong public/, Vercel sẽ tự động hiển thị nó.
app.use(express.static('public')); 

function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'RoskAI/1.0.0 (Node.js)',
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const req = protocol.request(reqOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({
                        data: data,
                        json: () => {
                            try {
                                return JSON.parse(data);
                            } catch (e) {
                                console.error(`[makeRequest] Failed to parse JSON from ${url}:`, e.message);
                                return null;
                            }
                        },
                        status: res.statusCode,
                        ok: true,
                        headers: res.headers
                    });
                } else {
                    const error = new Error(`Request failed with status ${res.statusCode}`);
                    error.statusCode = res.statusCode;
                    error.responseBody = data;
                    reject(error);
                }
            });
        });

        req.on('error', (e) => {
            console.error(`[makeRequest] Request error for ${url}:`, e.message);
            reject(e);
        });

        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

const chatHistory = [];

app.post('/chat', upload.array('files'), async (req, res) => {
    const { message, thinkingMode } = req.body;
    const uploadedFiles = req.files || [];

    if (!message && uploadedFiles.length === 0) {
        return res.status(400).json({ error: 'Tin nhắn không được để trống và không có file nào được tải lên.' });
    }

    const now = new Date();
    const currentDateString = now.toLocaleDateString('vi-VN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    let historyPrompt = '';
    if (chatHistory.length > 0) {
        chatHistory.slice(-6).forEach(entry => {
            historyPrompt += `${entry.role}: ${entry.content}\n`;
        });
        historyPrompt += '\n';
    }

    let fileContentsForAI = [];
    for (const file of uploadedFiles) {
        try {
            const fileExtension = file.originalname.split('.').pop().toLowerCase();
            let content = '';

            if (fileExtension === 'txt') {
                content = file.buffer.toString('utf8');
            } else if (fileExtension === 'pdf') {
                const data = await pdf(file.buffer);
                content = data.text;
            } else if (fileExtension === 'docx') {
                content = await new Promise((resolve, reject) => {
                    let docxText = '';
                    const bufferStream = new stream.PassThrough();
                    bufferStream.end(file.buffer);

                    bufferStream.pipe(unzipper.ParseOne('word/document.xml'))
                        .on('error', (err) => {
                            console.error(`Lỗi giải nén hoặc đọc entry trong ${file.originalname}:`, err);
                            reject(new Error(`Lỗi nội bộ khi đọc DOCX: ${err.message}`));
                        })
                        .on('entry', async (entry) => {
                            try {
                                const xmlBuffer = await entry.buffer();
                                docxText = xmlBuffer.toString('utf8');
                                let cleanContent = docxText.replace(/<[^>]*>/g, '');
                                cleanContent = cleanContent.replace(/&nbsp;/g, ' ');
                                cleanContent = cleanContent.replace(/&#xa;/g, '\n');
                                resolve(cleanContent);
                            } catch (readError) {
                                console.error(`Lỗi khi đọc nội dung XML từ ${file.originalname}:`, readError);
                                reject(new Error(`Không thể đọc nội dung XML từ DOCX: ${readError.message}`));
                            }
                        });
                        bufferStream.on('finish', () => {
                            if (!docxText) {
                                reject(new Error("Không tìm thấy word/document.xml trong file DOCX hoặc file rỗng."));
                            }
                        });
                });
                
                if (!content) {
                    throw new Error("Không thể trích xuất nội dung từ file DOCX.");
                }

            } else {
                console.warn(`File with unsupported extension "${fileExtension}" was not filtered and skipped.`);
                continue;
            }
            fileContentsForAI.push(`--- File: ${file.originalname} ---\n${content}\n--- End File: ${file.originalname} ---`);

        } catch (fileReadError) {
            console.error(`Lỗi khi đọc file ${file.originalname} trên server:`, fileReadError);
            fileContentsForAI.push(`--- Lỗi khi đọc file ${file.originalname}: ${fileReadError.message}. Rosk AI có thể không truy cập được hoặc file bị lỗi hoặc định dạng không chuẩn. ---`);
        }
    }

    let filePrompt = '';
    if (fileContentsForAI.length > 0) {
        filePrompt = '\n\n**Dữ liệu từ file đã tải lên:**\n' + fileContentsForAI.join('\n\n') + '\n\n';
    }

    let botResponse;

    try {
        if (thinkingMode) {
            console.log('Thinking Mode: ON - Rosk AI đang suy nghĩ sâu...');
            const internalThinkingPrompt = `Bạn là một trợ lý AI có khả năng phân tích sâu sắc.
            Hãy phân tích yêu cầu sau của người dùng, liệt kê các điểm chính cần được giải quyết, các thông tin quan trọng cần được đưa vào, và lập kế hoạch chi tiết để tạo ra một câu trả lời hoàn chỉnh, chính xác, và dễ hiểu.
            Đừng đưa ra câu trả lời cuối cùng, chỉ tập trung vào quá trình suy nghĩ và các yếu tố cần thiết.
            
            Lịch sử trò chuyện:
            ${historyPrompt}
            ${filePrompt}
            Yêu cầu của người dùng: "${message}"
            Phân tích và kế hoạch của bạn:`;

            const internalGeminiResponse = await makeRequest(
                `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: internalThinkingPrompt }] }]
                    })
                }
            );

            const internalGeminiData = await internalGeminiResponse.json();
            const internalThought = internalGeminiData.candidates[0]?.content?.parts[0]?.text || 'Không thể tạo suy nghĩ nội bộ.';
            console.log('Rosk AI - Suy nghĩ nội bộ:\n', internalThought);

            const finalAnswerPrompt = `Bạn là Rosk AI, một trợ lý thông minh và thân thiện.
            Thông tin hiện tại: ${currentDateString}.
            Bạn là phiên bản 1.0.0.
            Dựa trên phân tích và kế hoạch nội bộ sau, hãy tạo ra câu trả lời hoàn chỉnh, tự nhiên, hữu ích, súc tích và chính xác nhất cho người dùng.
            Khi bạn cần biểu diễn các công thức toán học, hãy sử dụng cú pháp LaTeX.
            Sử dụng $...$ cho công thức nội tuyến và $$...$$ cho các khối công thức riêng biệt.
            ---
            ${internalThought}
            ---
            Lịch sử trò chuyện:
            ${historyPrompt}
            ${filePrompt}
            Yêu cầu của người dùng: "${message}"
            Rosk AI:`;

            const finalGeminiResponse = await makeRequest(
                `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: finalAnswerPrompt }] }]
                    })
                }
            );
            const finalGeminiData = await finalGeminiResponse.json();
            botResponse = finalGeminiData.candidates[0]?.content?.parts[0]?.text || 'Rosk AI không thể tạo ra phản hồi lúc này.';

        } else {
            console.log('Thinking Mode: OFF - Rosk AI đang trả lời trực tiếp...');
            const finalPrompt = `Bạn là Rosk AI, trợ lý trò chuyện thông minh và thân thiện.
            Thông tin hiện tại: ${currentDateString}.
            Bạn là phiên bản 1.0.0.
            Trả lời tự nhiên, hữu ích, súc tích và chính xác nhất có thể dựa trên kiến thức của bạn.
            Khi bạn cần biểu diễn các công thức toán học, hãy sử dụng cú pháp LaTeX.
            Sử dụng $...$ cho công thức nội tuyến và $$...$$ cho các khối công thức riêng biệt.
            
            Lịch sử trò chuyện:
            ${historyPrompt}
            ${filePrompt}
            Người dùng: ${message}
            Rosk AI:`;

            const geminiResponse = await makeRequest(
                `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: finalPrompt }] }]
                    })
                }
            );
            const geminiData = await geminiResponse.json();
            botResponse = geminiData.candidates[0]?.content?.parts[0]?.text || 'Rosk AI không thể tạo ra phản hồi lúc này.';
        }

        chatHistory.push({ role: 'user', content: message });
        chatHistory.push({ role: 'bot', content: botResponse });

        res.json({ response: botResponse.trim(), sources: [] });

    } catch (error) {
        console.error('Lỗi khi gọi API Gemini hoặc mạng:', error.message);
        let errorMessage = 'Không thể kết nối đến dịch vụ của Rosk AI. Vui lòng kiểm tra kết nối mạng hoặc Glitch project của bạn.';
        
        if (error.statusCode) {
            try {
                const errorDetails = JSON.parse(error.responseBody);
                if (error.statusCode === 400) {
                    errorMessage = 'Rosk AI không thể xử lý yêu cầu này (có thể câu hỏi quá dài hoặc phức tạp). Vui lòng thử hỏi ngắn gọn hơn.';
                } else if (error.statusCode === 403 || error.statusCode === 401) {
                    errorMessage = 'Lỗi xác thực API Key của Gemini. Vui lòng kiểm tra lại GEMINI_API_KEY của bạn.';
                } else if (error.statusCode === 429) {
                    errorMessage = 'Rosk AI đang quá tải. Vui lòng thử lại sau ít phút.';
                } else if (errorDetails && errorDetails.error && errorDetails.error.message) {
                    errorMessage = `Lỗi từ Rosk AI: ${errorDetails.error.message}`;
                }
            } catch (parseError) {
                errorMessage = `Có lỗi xảy ra từ Rosk AI: ${error.message}`;
            }
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            errorMessage = 'Không thể kết nối đến dịch vụ của Rosk AI. Vui lòng kiểm tra kết nối mạng hoặc Glitch project của bạn.';
        }
        
        res.status(500).json({ error: errorMessage });
    }
});

// XÓA DÒNG app.listen(...) NÀY
// app.listen(port, () => {
//     console.log(`Server is running on port ${port}`);
//     console.log(`Rosk AI v1.0.0 is ready! Open your Glitch project URL to access the app.`);
// });

// THÊM DÒNG NÀY ĐỂ EXPORT ỨNG DỤNG EXPRESS
module.exports = app;
