const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 托管静态文件
app.use(express.static(__dirname));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log('===========================================');
  console.log('  QBTI 独立家长端已启动');
  console.log('  端口: ' + PORT);
  console.log('===========================================');
});