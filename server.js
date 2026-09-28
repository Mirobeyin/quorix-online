const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// =====================================================
// QUORIX ONLINE SERVER
// =====================================================

const PORT = process.env.PORT || 10000;

// =====================================================
// HTTP SERVER
// =====================================================

const server = http.createServer((req, res) => {

    console.log('HTTP REQUEST:', req.method, req.url);

    const pathname = String(req.url || '/').split('?')[0];

    // =================================================
    // ANA SAYFA
    // =================================================

    if (pathname === '/' || pathname === '/index.html') {

        const filePath = path.join(__dirname, 'index.html');

        fs.readFile(filePath, (err, data) => {

            if (err) {

                console.error('index.html okuma hatası:', err);

                res.writeHead(500, {
                    'Content-Type': 'text/plain; charset=utf-8'
                });

                res.end(
                    'Quorix index.html bulunamadı.\n\n' +
                    filePath
                );

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

    // =================================================
    // SERVER TEST
    // =================================================

    if (pathname === '/health') {

        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8'
        });

        res.end('Quorix online server aktif.');

        return;
    }

    // =================================================
    // FAVICON
    // =================================================

    if (pathname === '/favicon.ico') {

        res.writeHead(204);
        res.end();

        return;
    }

    // =================================================
    // 404
    // =================================================

    res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8'
    });

    res.end('Sayfa bulunamadı.');
});

// =====================================================
// WEBSOCKET SERVER
// =====================================================

const wss = new WebSocket.Server({
    server: server
});

// =====================================================
// ODALAR
// =====================================================

const rooms = new Map();

// Her WebSocket'in bilgisi
const socketInfo = new Map();

// =====================================================
// ODA KODU
// =====================================================

function generateRoomCode() {

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    let code = '';

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

// =====================================================
// İSİM TEMİZLE
// =====================================================

function cleanPlayerName(name) {

    name = String(name || '')
        .trim()
        .replace(/\s+/g, ' ');

    return name.slice(0, 16) || 'Oyuncu';
}

// =====================================================
// MESAJ GÖNDER
// =====================================================

function send(ws, message) {

    if (!ws) return;

    if (ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify(message));
}

// =====================================================
// ODAYA MESAJ GÖNDER
// =====================================================

function broadcastRoom(room, message) {

    if (!room) return;

    if (room.player1) {
        send(room.player1, message);
    }

    if (room.player2) {
        send(room.player2, message);
    }
}

// =====================================================
// WEBSOCKET BAĞLANTISI
// =====================================================

wss.on('connection', (ws) => {

    console.log('Yeni WebSocket bağlantısı.');

    // =================================================
    // MESAJ GELDİ
    // =================================================

    ws.on('message', (raw) => {

        let data;

        try {

            data = JSON.parse(raw.toString());

        } catch (error) {

            console.log('Geçersiz JSON.');

            send(ws, {
                type: 'error',
                message: 'Geçersiz mesaj.'
            });

            return;
        }

        console.log(
            'WS MESSAGE:',
            data.type
        );

        // =================================================
        // ODA OLUŞTUR
        // Client:
        // { type:"create", name:"Ahmet" }
        // =================================================

        if (data.type === 'create') {

            if (socketInfo.has(ws)) {

                send(ws, {
                    type: 'error',
                    message: 'Zaten bir odaya bağlısın.'
                });

                return;
            }

            const roomCode = generateRoomCode();

            const room = {

                code: roomCode,

                player1: ws,
                player2: null,

                player1Name: cleanPlayerName(data.name),
                player2Name: 'Oyuncu',

                turn: 1
            };

            rooms.set(roomCode, room);

            socketInfo.set(ws, {

                roomCode: roomCode,

                player: 1
            });

            send(ws, {

                type: 'room-created',

                code: roomCode,

                player: 1,

                playerNames: {
                    1: room.player1Name,
                    2: room.player2Name
                }
            });

            console.log(
                `Oda oluşturuldu: ${roomCode} | Oyuncu 1: ${room.player1Name}`
            );

            return;
        }

        // =================================================
        // ODAYA KATIL
        // Client:
        // { type:"join", code:"ABC123", name:"Mehmet" }
        // =================================================

        if (data.type === 'join') {

            if (socketInfo.has(ws)) {

                send(ws, {
                    type: 'error',
                    message: 'Zaten bir odaya bağlısın.'
                });

                return;
            }

            const roomCode = String(
                data.code || ''
            )
            .trim()
            .toUpperCase();

            if (!roomCode) {

                send(ws, {
                    type: 'error',
                    message: 'Oda kodu girilmedi.'
                });

                return;
            }

            const room = rooms.get(roomCode);

            // =================================================
            // ODA YOK
            // =================================================

            if (!room) {

                send(ws, {
                    type: 'error',
                    message: 'Bu oda bulunamadı.'
                });

                return;
            }

            // =================================================
            // ODA DOLU
            // =================================================

            if (room.player1 && room.player2) {

                send(ws, {
                    type: 'error',
                    message: 'Bu oda dolu.'
                });

                return;
            }

            // =================================================
            // OYUNCU 2
            // =================================================

            room.player2 = ws;

            room.player2Name =
                cleanPlayerName(data.name);

            socketInfo.set(ws, {

                roomCode: roomCode,

                player: 2
            });

            // =================================================
            // OYUNCU 2'YE BİLGİ
            // =================================================

            send(ws, {

                type: 'joined',

                code: roomCode,

                player: 2,

                playerNames: {
                    1: room.player1Name,
                    2: room.player2Name
                }
            });

            // =================================================
            // OYUNU BAŞLAT
            // =================================================

            broadcastRoom(room, {

                type: 'game-start',

                code: roomCode,

                turn: room.turn,

                playerNames: {
                    1: room.player1Name,
                    2: room.player2Name
                }
            });

            console.log(
                `Oyuncu 2 odaya katıldı: ${roomCode} | Oyuncu 2: ${room.player2Name}`
            );

            return;
        }

        // =================================================
        // İSİM DEĞİŞTİR
        //
        // Client:
        // { type:"set-name", name:"Yeniİsim" }
        // =================================================

        if (data.type === 'set-name') {

            const info = socketInfo.get(ws);

            if (!info) {

                send(ws, {
                    type: 'error',
                    message: 'Bir odaya bağlı değilsin.'
                });

                return;
            }

            const room = rooms.get(info.roomCode);

            if (!room) {

                send(ws, {
                    type: 'error',
                    message: 'Oda artık mevcut değil.'
                });

                return;
            }

            const newName =
                cleanPlayerName(data.name);

            // Oyuncunun ismini güncelle
            if (info.player === 1) {

                room.player1Name = newName;

            } else {

                room.player2Name = newName;
            }

            console.log(
                `İsim değişti: ${info.roomCode} | Oyuncu ${info.player} | ${newName}`
            );

            // =================================================
            // İKİ OYUNCUYA DA YENİ İSİMLERİ GÖNDER
            // =================================================

            broadcastRoom(room, {

                type: 'player-name-changed',

                player: info.player,

                name: newName,

                playerNames: {
                    1: room.player1Name,
                    2: room.player2Name
                }
            });

            return;
        }

        // =================================================
        // OYUN HAMLESİ
        //
        // Client:
        // {
        //   type:"action",
        //   player:1,
        //   action:{...}
        // }
        // =================================================

        if (data.type === 'action') {

            const info = socketInfo.get(ws);

            if (!info) {

                send(ws, {
                    type: 'error',
                    message: 'Bir odaya bağlı değilsin.'
                });

                return;
            }

            const room = rooms.get(
                info.roomCode
            );

            if (!room) {

                send(ws, {
                    type: 'error',
                    message: 'Oda artık mevcut değil.'
                });

                return;
            }

            // =================================================
            // SIRA KONTROLÜ
            // =================================================

            if (room.turn !== info.player) {

                send(ws, {
                    type: 'error',
                    message: 'Sıra rakibinde.'
                });

                return;
            }

            // =================================================
            // RAKİP
            // =================================================

            const opponent =
                info.player === 1
                    ? room.player2
                    : room.player1;

            // =================================================
            // HAMLEYİ RAKİBE GÖNDER
            // =================================================

            if (opponent) {

                send(opponent, {

                    type: 'action',

                    player: info.player,

                    action: data.action
                });
            }

            // =================================================
            // SIRAYI DEĞİŞTİR
            // =================================================

            room.turn =
                info.player === 1
                    ? 2
                    : 1;

            console.log(
                `Hamle: ${info.roomCode} | Oyuncu ${info.player}`
            );

            return;
        }

        // =================================================
        // PING
        // =================================================

        if (data.type === 'ping') {

            send(ws, {
                type: 'pong'
            });

            return;
        }

        // =================================================
        // BİLİNMEYEN MESAJ
        // =================================================

        send(ws, {

            type: 'error',

            message: 'Bilinmeyen mesaj türü.'
        });

    });

    // =================================================
    // BAĞLANTI KAPANDI
    // =================================================

    ws.on('close', () => {

        console.log(
            'WebSocket bağlantısı kapandı.'
        );

        const info = socketInfo.get(ws);

        if (!info) return;

        const room = rooms.get(
            info.roomCode
        );

        socketInfo.delete(ws);

        if (!room) return;

        // =================================================
        // RAKİP
        // =================================================

        const opponent =
            info.player === 1
                ? room.player2
                : room.player1;

        // =================================================
        // RAKİBE HABER VER
        // =================================================

        if (opponent) {

            send(opponent, {

                type: 'opponent-left'
            });

            socketInfo.delete(opponent);

            try {

                opponent.close();

            } catch (error) {

                // Bağlantı zaten kapanmış olabilir

            }
        }

        // =================================================
        // ODAYI SİL
        // =================================================

        rooms.delete(
            info.roomCode
        );

        console.log(
            `Oda kapatıldı: ${info.roomCode}`
        );

    });

    // =================================================
    // WEBSOCKET HATASI
    // =================================================

    ws.on('error', (error) => {

        console.error(
            'WebSocket hatası:',
            error.message
        );

    });

});

// =====================================================
// SERVER'I BAŞLAT
// =====================================================

server.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            '===================================='
        );

        console.log(
            '       QUORIX ONLINE SERVER'
        );

        console.log(
            '===================================='
        );

        console.log(
            `Server portu: ${PORT}`
        );

        console.log(
            `Server aktif: http://0.0.0.0:${PORT}`
        );

        console.log(
            'index.html sunulmaya hazır.'
        );

        console.log(
            'WebSocket sunucusu aktif.'
        );

        console.log(
            'Oyuncu isim sistemi aktif.'
        );

        console.log(
            '===================================='
        );

    }
);

// =====================================================
// WEBSOCKET CANLI TUTMA
// =====================================================

const pingInterval = setInterval(() => {

    wss.clients.forEach((ws) => {

        if (ws.readyState === WebSocket.OPEN) {

            send(ws, {
                type: 'ping'
            });

        }

    });

}, 25000);

// =====================================================
// SERVER KAPANIRKEN
// =====================================================

server.on('close', () => {

    clearInterval(
        pingInterval
    );

});