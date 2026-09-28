const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 10000;

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
    });

    res.end('Quorix online server aktif.');
});

const wss = new WebSocketServer({ server });

const rooms = new Map();
const socketInfo = new Map();

function makeCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;

    do {
        code = '';

        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code));

    return code;
}

function send(ws, message) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(message));
    }
}

function leave(ws) {
    const info = socketInfo.get(ws);

    if (!info) return;

    const code = info.code;
    const player = info.player;

    socketInfo.delete(ws);

    if (!code) return;

    const room = rooms.get(code);

    if (!room) return;

    const other =
        player === 1
            ? room.player2
            : room.player1;

    if (other) {
        send(other, {
            type: 'opponent-left'
        });

        socketInfo.delete(other);
    }

    rooms.delete(code);
}

wss.on('connection', (ws) => {

    socketInfo.set(ws, {
        code: null,
        player: 0
    });

    send(ws, {
        type: 'connected'
    });

    ws.on('message', (raw) => {

        let msg;

        try {
            msg = JSON.parse(raw.toString());
        } catch {
            send(ws, {
                type: 'error',
                message: 'Geçersiz veri gönderildi.'
            });

            return;
        }

        const info = socketInfo.get(ws);

        if (!info) return;

        // ODA OLUŞTUR
        if (msg.type === 'create') {

            if (info.code) {
                send(ws, {
                    type: 'error',
                    message: 'Zaten bir odadasın.'
                });

                return;
            }

            const code = makeCode();

            const room = {
                code,
                player1: ws,
                player2: null,
                turn: 1,
                started: false
            };

            rooms.set(code, room);

            socketInfo.set(ws, {
                code,
                player: 1
            });

            send(ws, {
                type: 'room-created',
                player: 1,
                code
            });

            return;
        }

        // ODAYA KATIL
        if (msg.type === 'join') {

            if (info.code) {
                send(ws, {
                    type: 'error',
                    message: 'Zaten bir odadasın.'
                });

                return;
            }

            const code = String(msg.code || '')
                .trim()
                .toUpperCase();

            const room = rooms.get(code);

            if (!room) {
                send(ws, {
                    type: 'error',
                    message: 'Bu oda bulunamadı veya artık aktif değil.'
                });

                return;
            }

            if (room.player2) {
                send(ws, {
                    type: 'error',
                    message: 'Bu oda zaten dolu.'
                });

                return;
            }

            room.player2 = ws;
            room.started = true;
            room.turn = 1;

            socketInfo.set(ws, {
                code,
                player: 2
            });

            // 2. oyuncuya katıldı mesajı
            send(ws, {
                type: 'joined',
                player: 2,
                code
            });

            // İKİ OYUNCUYA DA OYUN BAŞLADI
            send(room.player1, {
                type: 'game-start',
                player: 1,
                code
            });

            send(room.player2, {
                type: 'game-start',
                player: 2,
                code
            });

            return;
        }

        // HAMLE
        if (msg.type === 'action') {

            const room = rooms.get(info.code);

            if (!room || !room.started) {

                send(ws, {
                    type: 'error',
                    message: 'Maç henüz başlamadı.'
                });

                return;
            }

            const player = Number(msg.player);
            const action = msg.action;

            // Oyuncu kontrolü
            if (player !== info.player) {

                send(ws, {
                    type: 'error',
                    message: 'Oyuncu bilgisi geçersiz.'
                });

                return;
            }

            // Sıra kontrolü
            if (player !== room.turn) {

                send(ws, {
                    type: 'error',
                    message: 'Şu anda senin sıran değil.'
                });

                return;
            }

            // Hamle kontrolü
            if (
                !action ||
                (action.type !== 'move' &&
                 action.type !== 'wall')
            ) {

                send(ws, {
                    type: 'error',
                    message: 'Geçersiz hamle.'
                });

                return;
            }

            const other =
                player === 1
                    ? room.player2
                    : room.player1;

            // Rakibe hamleyi gönder
            send(other, {
                type: 'action',
                player,
                action
            });

            // Sırayı değiştir
            room.turn =
                player === 1
                    ? 2
                    : 1;

            return;
        }

        // ODADAN ÇIK
        if (msg.type === 'leave') {
            leave(ws);
            return;
        }

        // PING
        if (msg.type === 'ping') {

            send(ws, {
                type: 'pong'
            });

            return;
        }
    });

    ws.on('close', () => {
        leave(ws);
    });

    ws.on('error', () => {
        leave(ws);
    });
});

// SERVER BAŞLAT
server.listen(PORT, '0.0.0.0', () => {
    console.log(
        `Quorix server listening on port ${PORT}`
    );
});

// Render bağlantısının canlı kalmasına yardımcı olur
setInterval(() => {

    for (const ws of wss.clients) {

        if (ws.readyState === 1) {

            try {
                ws.ping();
            } catch {}
        }
    }

}, 25000);