const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Папка для загрузки файлов
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadDir));

// Настройка SQLite базы данных
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('Ошибка подключения к SQLite:', err.message);
    } else {
        console.log('Подключено к SQLite.');
    }
});

// Создание таблиц
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        group_name TEXT NOT NULL,
        course INTEGER NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        text TEXT,
        fileUrl TEXT,
        fileType TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Настройка Multer для сохранения файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Buffer.from(file.originalname, 'latin1').toString('utf8'));
    }
});
const upload = multer({ storage });

// --- API ДЛЯ СТУДЕНТОВ ---
app.get('/api/students', (req, res) => {
    db.all("SELECT * FROM students", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/students', (req, res) => {
    const { name, group_name, course } = req.body;
    db.run("INSERT INTO students (name, group_name, course) VALUES (?, ?, ?)", [name, group_name, course], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, name, group_name, course });
    });
});

app.delete('/api/students/:id', (req, res) => {
    db.run("DELETE FROM students WHERE id = ?", req.params.id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- API ДЛЯ МУЗЫКИ ИЗ ЧАТА (ДЛЯ ПЛЕЕРА) ---
app.get('/api/local-tracks', (req, res) => {
    db.all("SELECT * FROM messages WHERE fileType = 'audio' ORDER BY id DESC", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const tracks = rows.map(msg => ({
            name: msg.text || path.basename(msg.fileUrl),
            artist_name: `Чат (${msg.username})`,
            audio: msg.fileUrl
        }));
        res.json(tracks);
    });
});

// --- ЗАГРУЗКА ФАЙЛОВ В ЧАТ ---
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    let fileType = 'file';
    if (req.file.mimetype.startsWith('image/')) fileType = 'image';
    else if (req.file.mimetype.startsWith('video/')) fileType = 'video';
    else if (req.file.mimetype.startsWith('audio/') || req.file.originalname.match(/\.(mp3|wav|ogg|mpeg)$/i)) fileType = 'audio';

    res.json({ fileUrl, fileType, originalName: req.file.originalname });
});

// --- WEBSOCKET ДЛЯ ЧАТА ---
io.on('connection', (socket) => {
    // Отправляем историю сообщений при подключении
    db.all("SELECT * FROM messages ORDER BY id DESC LIMIT 50", [], (err, rows) => {
        if (!err) {
            socket.emit('init_messages', rows.reverse());
        }
    });

    socket.on('chat_message', (data) => {
        const { username, text, fileUrl, fileType } = data;
        db.run(
            "INSERT INTO messages (username, text, fileUrl, fileType) VALUES (?, ?, ?, ?)",
            [username, text, fileUrl, fileType],
            function(err) {
                if (!err) {
                    const savedMsg = { id: this.lastID, username, text, fileUrl, fileType, timestamp: new Date().toISOString() };
                    io.emit('chat_message', savedMsg);
                }
            }
        );
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});