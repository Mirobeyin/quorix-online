const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 10000;

const publicFile = path.join(__dirname, 'index.html');

// ===============================
// HTTP SERVER
// ===============================

const server = http.createServer((req, res) => {

    // Ana sayfa
    if (req.url === '/' || req.url === '/index.html') {

        fs.readFile(publicFile, (err, data) => {

            if (err) {
                console.error('index.html okunamadı:', err);

                res.writeHead(500, {
                    'Content-Type': 'text/plain; charset=utf-8'
                });

                res.end('index.html bulunamadı.');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache'
            });

            res.end(data);
        });

        return;
    }

    // Sağlık kontrolü
    if (req.url === '/health') {

        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8'
        });

        res.end('Quorix online server aktif.');
        return;
    }

    // Bilinmeyen sayfa
    res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8'
    });

    res.end('Sayfa bulunamadı.');
});


// ===============================
// WEBSOCKET SERVER
// ===============================

const wss = new WebSocketServer({
    server
});

const rooms = new Map();
const socketInfo = new Map();


// ===============================
// ODA KODU OLUŞTUR
// ===============================

function makeCode() {

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    let code;

    do {

        code = '';

        for (let i = 0; i < 6; i++) {
            code += chars[
                Math.floor(Math.random() * chars.length)
            ];
        }

    } while (rooms.has(code));

    return code;
}


// ===============================
// MESAJ GÖNDER
// ===============================

function send(ws, message) {

    if (ws && ws.readyState === 1) {

        try {
            ws.send(JSON.stringify(message));
        } catch (error) {
            console.error('Mesaj gönderilemedi:', error);
        }
    }
}


// ===============================
// OYUNCUYU ODADAN ÇIKAR
// ===============================

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

    console.log(
        `Oda kapatıldı: ${code}`
    );
}


// ===============================
// YENİ BAĞLANTI
// ===============================

wss.on('connection', (ws) => {

    console.log('Yeni oyuncu bağlandı.');

    socketInfo.set(ws, {
        code: null,
        player: 0
    });


    send(ws, {
        type: 'connected'
    });


    // ===========================
    // MESAJLAR
    // ===========================

    ws.on('message', (raw) => {

        let msg;

        try {

            msg = JSON.parse(
                raw.toString()
            );

        } catch {

            send(ws, {
                type: 'error',
                message: 'Geçersiz veri gönderildi.'
            });

            return;
        }


        const info = socketInfo.get(ws);

        if (!info) return;


        // =========================
        // ODA OLUŞTUR
        // =========================

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


            console.log(
                `Oda oluşturuldu: ${code}`
            );


            send(ws, {

                type: 'room-created',

                player: 1,

                code

            });


            return;
        }


        // =========================
        // ODAYA KATIL
        // =========================

        if (msg.type === 'join') {

            if (info.code) {

                send(ws, {
                    type: 'error',
                    message: 'Zaten bir odadasın.'
                });

                return;
            }


            const code = String(
                msg.code || ''
            )
            .trim()
            .toUpperCase();


            const room = rooms.get(code);


            if (!room) {

                send(ws, {

                    type: 'error',

                    message:
                        'Bu oda bulunamadı veya artık aktif değil.'

                });

                return;
            }


            if (room.player2) {

                send(ws, {

                    type: 'error',

                    message:
                        'Bu oda zaten dolu.'

                });

                return;
            }


            // İkinci oyuncuyu yerleştir
            room.player2 = ws;

            room.started = true;

            room.turn = 1;


            socketInfo.set(ws, {

                code,

                player: 2

            });


            console.log(
                `Oyuncu odaya katıldı: ${code}`
            );


            // Oyuncu 2
            send(ws, {

                type: 'joined',

                player: 2,

                code

            });


            // Oyuncu 1
            send(room.player1, {

                type: 'game-start',

                player: 1,

                code

            });


            // Oyuncu 2
            send(room.player2, {

                type: 'game-start',

                player: 2,

                code

            });


            console.log(
                `Maç başladı: ${code}`
            );


            return;
        }


        // =========================
        // HAMLE
        // =========================

        if (msg.type === 'action') {

            const room =
                rooms.get(info.code);


            if (!room || !room.started) {

                send(ws, {

                    type: 'error',

                    message:
                        'Maç henüz başlamadı.'

                });

                return;
            }


            const player =
                Number(msg.player);


            const action =
                msg.action;


            // Oyuncu doğrulama
            if (player !== info.player) {

                send(ws, {

                    type: 'error',

                    message:
                        'Oyuncu bilgisi geçersiz.'

                });

                return;
            }


            // Sıra kontrolü
            if (player !== room.turn) {

                send(ws, {

                    type: 'error',

                    message:
                        'Şu anda senin sıran değil.'

                });

                return;
            }


            // Hamle kontrolü
            if (
                !action ||
                (
                    action.type !== 'move' &&
                    action.type !== 'wall'
                )
            ) {

                send(ws, {

                    type: 'error',

                    message:
                        'Geçersiz hamle.'

                });

                return;
            }


            const other =
                player === 1
                    ? room.player2
                    : room.player1;


            // Hamleyi rakibe gönder
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


        // =========================
        // ODADAN AYRIL
        // =========================

        if (msg.type === 'leave') {

            leave(ws);

            return;
        }


        // =========================
        // PING
        // =========================

        if (msg.type === 'ping') {

            send(ws, {
                type: 'pong'
            });

            return;
        }

    });


    // ===========================
    // BAĞLANTI KAPANDI
    // ===========================

    ws.on('close', () => {

        console.log(
            'Oyuncu bağlantısı kapandı.'
        );

        leave(ws);
    });


    ws.on('error', (error) => {

        console.error(
            'WebSocket hatası:',
            error.message
        );

        leave(ws);
    });

});


// ===============================
// SERVER BAŞLAT
// ===============================

server.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            `Quorix server listening on port ${PORT}`
        );

    }
);


// ===============================
// RENDER CANLI TUTMA
// ===============================

setInterval(() => {

    for (const ws of wss.clients) {

        if (ws.readyState === 1) {

            try {
                ws.ping();
            } catch {}

        }

    }

}, 25000);