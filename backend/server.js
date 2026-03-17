// 1. IMPORTS
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt'); // 🔥 ADDED
require('dotenv').config();       // 🔥 ADDED (to read .env file)

// 2. CONFIG
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const PORT = 3000;

// 3. MIDDLEWARE
app.use(cors());
app.use(express.json()); // <--- CRITICAL: MUST HAVE THIS
app.use(express.static(path.join(__dirname, 'public')));

// 4. ROUTES
app.post('/api/admin-login', async (req, res) => {
    try {
        const { password } = req.body;
        
        // Ensure the environment variable exists
        if (!process.env.ADMIN_PASSWORD_HASH) {
            return res.status(500).json({ success: false, message: "Server config error" });
        }

        const valid = await bcrypt.compare(
            password,
            process.env.ADMIN_PASSWORD_HASH
        );

        res.json({ success: valid });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. DATA STATE
let users = {}; 
let bannedUsers = []; 

// 6. SOCKETS
io.on('connection', (socket) => {
    console.log(`Connection established: ${socket.id}`);

    socket.emit('user_list', Object.values(users));

    socket.on('join', (userData) => {
        const cleanName = userData.nickname.trim();
        if (bannedUsers.some(b => b.toLowerCase() === cleanName.toLowerCase())) {
            socket.emit('error_message', 'You are permanently banned from this server.');
            socket.disconnect();
            return;
        }
        users[socket.id] = { ...userData, nickname: cleanName };
        io.emit('system_message', `${cleanName} joined the chat.`);
        io.emit('user_list', Object.values(users));
    });

    socket.on('send_global_message', (messageData) => {
        if (!users[socket.id]) return;
        io.emit('receive_global_message', {
            from: users[socket.id].nickname,
            text: messageData.text,
            age: users[socket.id].age,
            gender: users[socket.id].gender,
            time: new Date().toLocaleTimeString(),
            isAdmin: false 
        });
    });

    socket.on('send_private_message', ({ toNickname, text }) => {
        const targetSocketId = Object.keys(users).find(id => 
            users[id].nickname.toLowerCase() === toNickname.toLowerCase().trim()
        );
        if (targetSocketId) {
            io.to(targetSocketId).emit('receive_private_message', {
                from: users[socket.id].nickname,
                text: text
            });
        }
    });

    socket.on('admin_broadcast', (text) => {
        io.emit('receive_global_message', {
            from: "📢 SYSTEM ANNOUNCEMENT",
            text: text,
            isAdmin: true, 
            time: new Date().toLocaleTimeString()
        });
    });

    socket.on('admin_kick', (nickname) => {
        const targetId = Object.keys(users).find(id => 
            users[id].nickname.toLowerCase() === nickname.toLowerCase().trim()
        );
        if (targetId) {
            io.to(targetId).emit('kicked_notice', 'You have been kicked by an administrator.');
            const targetSocket = io.sockets.sockets.get(targetId);
            if (targetSocket) targetSocket.disconnect(true);
            delete users[targetId];
            io.emit('system_message', `${nickname} was kicked from the server.`);
            io.emit('user_list', Object.values(users));
        }
    });

    socket.on('admin_ban', (nickname) => {
        const cleanName = nickname.trim();
        if (!bannedUsers.includes(cleanName)) bannedUsers.push(cleanName);
        const targetId = Object.keys(users).find(id => 
            users[id].nickname.toLowerCase() === cleanName.toLowerCase()
        );
        if (targetId) {
            io.to(targetId).emit('kicked_notice', 'You have been PERMANENTLY BANNED.');
            const targetSocket = io.sockets.sockets.get(targetId);
            if (targetSocket) targetSocket.disconnect(true);
            delete users[targetId];
        }
        io.emit('system_message', `${cleanName} was BANNED by an administrator.`);
        io.emit('user_list', Object.values(users));
    });

    socket.on('disconnect', () => {
        if (users[socket.id]) {
            const nickname = users[socket.id].nickname;
            delete users[socket.id];
            io.emit('system_message', `${nickname} left the chat.`);
            io.emit('user_list', Object.values(users));
        }
    });
});

// 7. START SERVER
server.listen(PORT, () => {
    console.log(`SERVER RUNNING ON http://localhost:${PORT}`);
});