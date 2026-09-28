const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 10000;

const server = http.createServer((req, res) => {
    console.log('HTTP:', req.method, req.url);

    // Ana sayfa
    if (req.url === '/' || req.url.startsWith('/index.html')) {
        const file = path.join(__dirname, 'index.html');

        fs.readFile(file, (err, data) => {
            if (err) {
                console.error('INDEX HATASI:', err);

                res.writeHead(500, {
                    'Content-Type': 'text/plain; charset=utf-8'
                });

                res.end('index.html bulunamadı.');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });

            res.end(data);
        });

        return;
    }

    // Sağlık kontrolü
    if (req.url.startsWith('/health')) {
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8'
        });

        res.end('Quorix online server aktif.');
        return;
    }

    // 404
    res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8'
    });

    res.end('Sayfa bulunamadı.');
});


// ================================
// WEBSOCKET
// ================================

const wss = new WebSocketServer({
    server
});

const rooms = new Map();
const socketInfo = new Map();


// ================================
// ODA KODU
// ================================

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


// ================================
// MESAJ GÖNDER
// ================================

function send(ws, message) {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(message));
    }
}


// ================================
// OYUNCU ÇIKIŞI
// ================================

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

        try {
            other.close();
        } catch {}
    }

    rooms.delete(code);

    console.log('Oda kapatıldı:', code);
}


// ================================
// WEBSOCKET BAĞLANTISI
// ================================

wss.on('connection', (ws) => {

    console.log('WebSocket oyuncu bağlandı.');

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

            console.log('Oda oluşturuldu:', code);

            send(ws, {
                type: 'room-created',
                player: 1,
                code
            });

            return;
        }


        // ODAYA KATIL
        if (msg.type === 'join') {

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

            console.log('Oyuncu 2 katıldı:', code);

            send(ws, {
                type: 'joined',
                player: 2,
                code
            });

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

            console.log('Maç başladı:', code);

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

            if (player !== info.player) {
                send(ws, {
                    type: 'error',
                    message: 'Oyuncu bilgisi geçersiz.'
                });

                return;
            }

            if (player !== room.turn) {
                send(ws, {
                    type: 'error',
                    message: 'Şu anda senin sıran değil.'
                });

                return;
            }

            if (
                !action ||
                (
                    action.type !== 'move' &&
                    action.type !== 'wall'
                )
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

            send(other, {
                type: 'action',
                player,
                action
            });

            room.turn =
                player === 1
                    ? 2
                    : 1;

            return;
        }


        // ÇIKIŞ
        if (msg.type === 'leave') {
            leave(ws);
            return;
        }


        // PING
        if (msg.type === 'ping') {
            send(ws, {
                type: 'pong'
            });
        }

    });


    ws.on('close', () => {
        leave(ws);
    });


    ws.on('error', () => {
        leave(ws);
    });

});


// ================================
// SERVER
// ================================

server.listen(PORT, '0.0.0.0', () => {
    console.log(
        `Quorix server listening on port ${PORT}`
    );
});


// Render bağlantısı
setInterval(() => {

    for (const ws of wss.clients) {

        if (ws.readyState === 1) {

            try {
                ws.ping();
            } catch {}

        }
    }

}, 25000);