const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Создаем папку для загрузки файлов (фото, видео, музыка), если её нет
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
app.use('/uploads', express.static(uploadDir));

// Настройка Multer для сохранения файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// База данных SQLite
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Ошибка БД:', err.message);
    } else {
        console.log('Подключено к SQLite.');
        db.run(`CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY,
            name TEXT,
            age INTEGER,
            specialty TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            text TEXT,
            fileUrl TEXT,
            fileType TEXT,
            time TEXT
        )`);
    }
});

// Роуты студентов
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/students', (req, res) => {
    db.all("SELECT * FROM students ORDER BY id ASC", [], (err, rows) => {
        if (err) { res.status(500).json({ error: err.message }); return; }
        res.json(rows);
    });
});

app.post('/api/students', (req, res) => {
    const { id: customId, name, age, specialty } = req.body;
    db.all("SELECT id FROM students ORDER BY id ASC", [], (err, rows) => {
        let targetId;
        if (customId) {
            targetId = Number(customId);
        } else {
            targetId = 1;
            for (let i = 0; i < rows.length; i++) {
                if (rows[i].id === targetId) { targetId++; } else { break; }
            }
        }
        db.run("INSERT INTO students (id, name, age, specialty) VALUES (?, ?, ?, ?)", 
            [targetId, name, age || 19, specialty || 'ИС'], function(err) {
            if (err) { res.status(400).json({ error: 'Ошибка: Такой ID уже занят.' }); return; }
            db.get("SELECT * FROM students WHERE id = ?", [targetId], (err, row) => {
                res.status(201).json({ message: `Студент добавлен с ID ${targetId}!`, student: row });
            });
        });
    });
});

app.put('/api/students/:id', (req, res) => {
    const id = req.params.id;
    const { name, age, specialty } = req.body;
    db.run("UPDATE students SET name = ?, age = ?, specialty = ? WHERE id = ?", [name, age || 19, specialty || 'ИС', id], function(err) {
        if (err) { res.status(500).json({ error: err.message }); return; }
        res.json({ message: `Данные обновлены!` });
    });
});

app.delete('/api/students/:id', (req, res) => {
    const id = req.params.id;
    db.run("DELETE FROM students WHERE id = ?", id, function(err) {
        if (err) { res.status(500).json({ error: err.message }); return; }
        res.json({ message: 'Удалено!' });
    });
});

// Загрузка файлов в чате
app.post('/api/upload', upload.single('mediaFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    let fileType = 'file';
    if (req.file.mimetype.startsWith('image/')) fileType = 'image';
    else if (req.file.mimetype.startsWith('video/')) fileType = 'video';
    else if (req.file.mimetype.startsWith('audio/')) fileType = 'audio';

    res.json({ fileUrl, fileType, originalName: req.file.originalname });
});

// WebSocket для чата
io.on('connection', (socket) => {
    db.all("SELECT * FROM messages ORDER BY id DESC LIMIT 50", [], (err, rows) => {
        if (!err && rows) {
            socket.emit('loadHistory', rows.reverse());
        }
    });

    socket.on('chatMessage', (data) => {
        const { username, text, fileUrl, fileType } = data;
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        db.run("INSERT INTO messages (username, text, fileUrl, fileType, time) VALUES (?, ?, ?, ?, ?)",
            [username || 'Аноним', text || '', fileUrl || null, fileType || null, time], function(err) {
            if (!err) {
                const messageObj = { id: this.lastID, username: username || 'Аноним', text, fileUrl, fileType, time };
                io.emit('chatMessage', messageObj);
            }
        });
    });
});

let browserOpened = false;
server.listen(PORT, '0.0.0.0', () => {
    const url = `http://localhost:${PORT}`;
    console.log('Сервер запущен: ' + url);
    if (!browserOpened) {
        browserOpened = true;
        exec(`start ${url}`);
    }
});