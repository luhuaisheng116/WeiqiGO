const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const BOARD_SIZE = 9;
const EMPTY = null;
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const rooms = new Map();

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => EMPTY),
  );
}

function createRoom(roomId) {
  return {
    id: roomId,
    board: createEmptyBoard(),
    currentTurn: "black",
    clients: new Set(),
    players: {
      black: null,
      white: null,
    },
    lastMove: null,
    moveCount: 0,
  };
}

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, createRoom(roomId));
  }
  return rooms.get(roomId);
}

function getNeighbors(x, y) {
  return DIRECTIONS.map(([dx, dy]) => [x + dx, y + dy]).filter(
    ([nx, ny]) => nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE,
  );
}

function cloneBoard(board) {
  return board.map((row) => [...row]);
}

function collectGroup(board, x, y) {
  const color = board[y][x];
  if (!color) {
    return { stones: [], liberties: 0 };
  }

  const queue = [[x, y]];
  const visited = new Set();
  const stones = [];
  const liberties = new Set();

  while (queue.length) {
    const [cx, cy] = queue.pop();
    const key = `${cx},${cy}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    stones.push([cx, cy]);

    for (const [nx, ny] of getNeighbors(cx, cy)) {
      const value = board[ny][nx];
      if (value === EMPTY) {
        liberties.add(`${nx},${ny}`);
      } else if (value === color && !visited.has(`${nx},${ny}`)) {
        queue.push([nx, ny]);
      }
    }
  }

  return { stones, liberties: liberties.size };
}

function removeGroup(board, stones) {
  for (const [x, y] of stones) {
    board[y][x] = EMPTY;
  }
}

function applyMove(board, x, y, color) {
  if (board[y][x] !== EMPTY) {
    return { valid: false, reason: "该位置已有棋子。" };
  }

  const nextBoard = cloneBoard(board);
  nextBoard[y][x] = color;

  const opponent = color === "black" ? "white" : "black";
  let captured = 0;

  for (const [nx, ny] of getNeighbors(x, y)) {
    if (nextBoard[ny][nx] !== opponent) {
      continue;
    }
    const group = collectGroup(nextBoard, nx, ny);
    if (group.liberties === 0) {
      captured += group.stones.length;
      removeGroup(nextBoard, group.stones);
    }
  }

  const ownGroup = collectGroup(nextBoard, x, y);
  if (ownGroup.liberties === 0) {
    return { valid: false, reason: "这里会形成自杀棋。" };
  }

  return { valid: true, board: nextBoard, captured };
}

function getRoleForSocket(room, socket) {
  if (room.players.black === socket) {
    return "black";
  }
  if (room.players.white === socket) {
    return "white";
  }
  return "viewer";
}

function createRoomState(room, socket, message = "") {
  const role = getRoleForSocket(room, socket);
  const readyPlayers = Object.values(room.players).filter(Boolean).length;

  return {
    type: "state",
    roomId: room.id,
    board: room.board,
    yourRole: role,
    currentTurn: room.currentTurn,
    readyPlayers,
    isRoomFull: readyPlayers >= 2,
    moveCount: room.moveCount,
    lastMove: room.lastMove,
    message,
  };
}

function broadcastRoom(room, message = "") {
  for (const client of room.clients) {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(createRoomState(room, client, message)));
    }
  }
}

function assignSeat(room, socket) {
  if (!room.players.black) {
    room.players.black = socket;
    return "black";
  }
  if (!room.players.white) {
    room.players.white = socket;
    return "white";
  }
  return "viewer";
}

function releaseSeat(socket) {
  for (const room of rooms.values()) {
    let changed = false;
    room.clients.delete(socket);
    if (room.players.black === socket) {
      room.players.black = null;
      changed = true;
    }
    if (room.players.white === socket) {
      room.players.white = null;
      changed = true;
    }

    if (changed) {
      broadcastRoom(room, "有玩家离开了房间。");
    }

    if (room.clients.size === 0) {
      rooms.delete(room.id);
    }
  }
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
    };

    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const requestedPath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  serveFile(filePath, res);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "消息格式无效。" }));
      return;
    }

    if (payload.type === "join") {
      if (socket.roomId) {
        releaseSeat(socket);
      }

      const roomId =
        typeof payload.roomId === "string" && payload.roomId.trim()
          ? payload.roomId.trim().slice(0, 24)
          : crypto.randomBytes(3).toString("hex");

      const room = ensureRoom(roomId);
      room.clients.add(socket);
      socket.roomId = roomId;
      socket.playerRole = assignSeat(room, socket);
      socket.send(JSON.stringify(createRoomState(room, socket)));
      broadcastRoom(room, "房间状态已更新。");
      return;
    }

    if (payload.type === "move") {
      if (!socket.roomId || typeof payload.x !== "number" || typeof payload.y !== "number") {
        socket.send(JSON.stringify({ type: "error", message: "落子参数无效。" }));
        return;
      }

      const room = rooms.get(socket.roomId);
      if (!room) {
        socket.send(JSON.stringify({ type: "error", message: "房间不存在。" }));
        return;
      }

      const role = getRoleForSocket(room, socket);
      if (role !== "black" && role !== "white") {
        socket.send(JSON.stringify({ type: "error", message: "只有房间内两位玩家可以落子。" }));
        return;
      }

      if (Object.values(room.players).filter(Boolean).length < 2) {
        socket.send(JSON.stringify({ type: "error", message: "请等待两位玩家都进入房间后再开始。" }));
        return;
      }

      if (role !== room.currentTurn) {
        socket.send(JSON.stringify({ type: "error", message: "还没轮到你。" }));
        return;
      }

      const x = Math.trunc(payload.x);
      const y = Math.trunc(payload.y);
      if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
        socket.send(JSON.stringify({ type: "error", message: "坐标超出棋盘范围。" }));
        return;
      }

      const result = applyMove(room.board, x, y, role);
      if (!result.valid) {
        socket.send(JSON.stringify({ type: "error", message: result.reason }));
        return;
      }

      room.board = result.board;
      room.currentTurn = role === "black" ? "white" : "black";
      room.moveCount += 1;
      room.lastMove = {
        x,
        y,
        color: role,
        captured: result.captured,
      };

      broadcastRoom(
        room,
        result.captured > 0 ? `提子 ${result.captured} 颗。` : "落子成功。",
      );
    }
  });

  socket.on("close", () => {
    releaseSeat(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Go MVP server listening on http://localhost:${PORT}`);
});
