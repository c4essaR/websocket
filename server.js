const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
}));

const clients = new Map();

app.get('/disconnect', (req, res) => {
    const userId = req.query.id;
    if (!userId) {
        return res.status(400).send('Необхідний параметр id');
    }

    const client = clients.get(userId);
    if (client) {
        client.send(JSON.stringify({ type: 'notification', message: 'Вас було відключено від чату' }));
        client.close();
        clients.delete(userId);
        console.log(`Користувач з ID ${userId} був відключений через HTTP-запит`);

        const leaveMessage = JSON.stringify({ type: 'notification', message: 'Користувач залишив чат' });
        broadcast(leaveMessage);
        res.send('Ви були відключені від чату');
    } else {
        res.status(404).send('Користувача з таким ID не знайдено');
    }
});

wss.on('connection', (ws, req) => {
    const userId = uuidv4();
    ws.userId = userId;
    clients.set(userId, ws);
    console.log(`Користувач приєднався з ID: ${userId}`);

    ws.send(JSON.stringify({ type: 'notification', message: 'Ви приєдналися до чату', userId }));

    const joinMessage = JSON.stringify({ type: 'notification', message: 'Новий користувач приєднався до чату' });
    broadcast(joinMessage);

    ws.on('message', (message) => {
        console.log(`Отримане повідомлення від ${userId}: ${message}`);

        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message);
        } catch (e) {
            console.error('Неправильний формат повідомлення:', e);
            return;
        }

        if (parsedMessage.type === 'message') {
            const broadcastMessage = JSON.stringify({
                type: 'message',
                content: parsedMessage.content,
                timestamp: new Date().toISOString(),
                userId
            });
            broadcast(broadcastMessage);

            notifyInactiveUsers(broadcastMessage, ws);
        }
    });

    ws.on('close', () => {
        clients.delete(userId);
        console.log(`Користувач з ID ${userId} від’єднався`);

        const leaveMessage = JSON.stringify({ type: 'notification', message: 'Користувач залишив чат' });
        broadcast(leaveMessage);
    });

    ws.on('error', (error) => {
        console.error(`Помилка з’єднання з користувачем ${userId}:`, error);
    });
});

function broadcast(data) {
    for (let [id, client] of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    }
}

function notifyInactiveUsers(message, sender) {
    const INACTIVITY_THRESHOLD = 30000;

    for (let [id, client] of clients) {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            const timeSinceLastActive = Date.now() - (client.lastActive || 0);
            if (timeSinceLastActive > INACTIVITY_THRESHOLD) {
                client.send(JSON.stringify({ type: 'notification', message: 'Нові повідомлення у чаті' }));
            }
        }
    }
}

const interval = setInterval(() => {
    for (let [id, ws] of clients) {
        if (ws.isAlive === false) {
            clients.delete(id);
            ws.terminate();
            console.log(`Користувач з ID ${id} відключений через неактивність`);

            const leaveMessage = JSON.stringify({ type: 'notification', message: 'Користувач залишив чат через неактивність' });
            broadcast(leaveMessage);
            continue;
        }

        ws.isAlive = false;
        ws.ping(() => {});
    }
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

server.listen(3000, () => {
    console.log('Сервер чату запущено на http://localhost:3000');
});
