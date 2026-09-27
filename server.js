const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

// index.html ve diğer dosyaları yayınla
app.use(express.static(path.join(__dirname)));

// Oyun odaları
const rooms = new Map();

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function createRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {
        code = "";

        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }

    } while (rooms.has(code));

    return code;
}

wss.on("connection", (ws) => {

    console.log("Oyuncu bağlandı.");

    ws.roomCode = null;
    ws.player = null;

    // -------------------------
    // MESAJLAR
    // -------------------------

    ws.on("message", (data) => {

        let msg;

        try {
            msg = JSON.parse(data.toString());
        } catch {
            return;
        }

        // =========================
        // ODA OLUŞTUR
        // =========================

        if (msg.type === "create") {

            const code = createRoomCode();

            const room = {
                players: [],
                started: false
            };

            rooms.set(code, room);

            room.players.push(ws);

            ws.roomCode = code;
            ws.player = 1;

            send(ws, {
                type: "room-created",
                code: code,
                player: 1
            });

            console.log("Oda oluşturuldu:", code);

            return;
        }

        // =========================
        // ODAYA KATIL
        // =========================

        if (msg.type === "join") {

            const code = String(msg.code || "")
                .trim()
                .toUpperCase();

            const room = rooms.get(code);

            if (!room) {

                send(ws, {
                    type: "error",
                    message: "Bu oda bulunamadı."
                });

                return;
            }

            if (room.players.length >= 2) {

                send(ws, {
                    type: "error",
                    message: "Bu oda zaten dolu."
                });

                return;
            }

            room.players.push(ws);

            ws.roomCode = code;
            ws.player = 2;

            send(ws, {
                type: "joined",
                code: code,
                player: 2
            });

            console.log("Oyuncu odaya katıldı:", code);

            // İki oyuncu tamamlandı
            if (room.players.length === 2) {

                room.started = true;

                room.players.forEach((playerSocket) => {

                    send(playerSocket, {
                        type: "game-start"
                    });

                });

                console.log("Oyun başladı:", code);
            }

            return;
        }

        // =========================
        // OYUN HAMLESİ
        // =========================

        if (msg.type === "action") {

            if (!ws.roomCode) return;

            const room = rooms.get(ws.roomCode);

            if (!room) return;

            // Rakibe gönder
            room.players.forEach((playerSocket) => {

                if (playerSocket !== ws) {

                    send(playerSocket, {
                        type: "action",
                        player: ws.player,
                        action: msg.action
                    });

                }

            });

            return;
        }

    });

    // =========================
    // BAĞLANTI KOPTU
    // =========================

    ws.on("close", () => {

        console.log("Oyuncu ayrıldı.");

        if (!ws.roomCode) return;

        const room = rooms.get(ws.roomCode);

        if (!room) return;

        // Oyuncuyu odadan çıkar
        room.players = room.players.filter(
            playerSocket => playerSocket !== ws
        );

        // Diğer oyuncuya haber ver
        room.players.forEach((playerSocket) => {

            send(playerSocket, {
                type: "opponent-left"
            });

        });

        // Oda boşsa sil
        if (room.players.length === 0) {

            rooms.delete(ws.roomCode);

            console.log(
                "Oda silindi:",
                ws.roomCode
            );

        } else {

            room.started = false;
        }
    });

    ws.on("error", (error) => {
        console.log("WebSocket hatası:", error.message);
    });

});


// =========================
// SUNUCU
// =========================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

    console.log(
        `Quorix sunucusu çalışıyor: http://localhost:${PORT}`
    );

});