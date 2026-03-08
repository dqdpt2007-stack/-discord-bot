const http = require('http');

// Tạo một web server ảo để Railway không dập tắt Bot
http.createServer((req, res) => {
  res.write("Bot dang hoat dong rat tot!");
  res.end();
}).listen(process.env.PORT || 8080);

console.log("🚀 Đang khởi động hệ thống Bot...");

// Chạy 2 file bot của bạn
require('./ket.js');
require('./ai.js');