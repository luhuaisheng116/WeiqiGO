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

function createSnapshot(room) {
  return {
    board: room.board.map((row) => [...row]),
    currentTurn: room.currentTurn,
    lastMove: room.lastMove ? { ...room.lastMove } : null,
    moveCount: room.moveCount,
    captures: { ...room.captures },
    consecutivePasses: room.consecutivePasses,
    gameStatus: room.gameStatus,
    winner: room.winner,
  };
}

function restoreSnapshot(room, snapshot) {
  room.board = snapshot.board.map((row) => [...row]);
  room.currentTurn = snapshot.currentTurn;
  room.lastMove = snapshot.lastMove ? { ...snapshot.lastMove } : null;
  room.moveCount = snapshot.moveCount;
  room.captures = { ...snapshot.captures };
  room.consecutivePasses = snapshot.consecutivePasses;
  room.gameStatus = snapshot.gameStatus;
  room.winner = snapshot.winner;
}

function createRoom(roomId) {
  const room = {
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
    captures: { black: 0, white: 0 },
    consecutivePasses: 0,
    gameStatus: "waiting",
    winner: null,
    pendingUndo: null,
    history: [],
  };
  room.history.push(createSnapshot(room));
  return room;
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
  if (room.players.black === socket) return "black";
  if (room.players.white === socket) return "white";
  return "viewer";
}

function getOpponentRole(role) {
  if (role === "black") return "white";
  if (role === "white") return "black";
  return null;
}

function getReadyPlayerCount(room) {
  return Object.values(room.players).filter(Boolean).length;
}

function syncRoomStatus(room) {
  if (room.gameStatus === "finished") return;
  room.gameStatus = getReadyPlayerCount(room) < 2 ? "waiting" : "playing";
}

function createRoomState(room, socket, message = "") {
  return {
    type: "state",
    roomId: room.id,
    board: room.board,
    yourRole: getRoleForSocket(room, socket),
    currentTurn: room.currentTurn,
    readyPlayers: getReadyPlayerCount(room),
    isRoomFull: getReadyPlayerCount(room) >= 2,
    moveCount: room.moveCount,
    lastMove: room.lastMove,
    message,
    captures: room.captures,
    consecutivePasses: room.consecutivePasses,
    gameStatus: room.gameStatus,
    winner: room.winner,
    pendingUndo: room.pendingUndo,
  };
}

function broadcastRoom(room, message = "") {
  for (const client of room.clients) {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify(createRoomState(room, client, message)));
    }
  }
}

function sendError(socket, message) {
  socket.send(JSON.stringify({ type: "error", message }));
}

function clearPendingUndo(room) {
  room.pendingUndo = null;
}

function pushHistory(room) {
  room.history.push(createSnapshot(room));
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
    const role = getRoleForSocket(room, socket);

    room.clients.delete(socket);
    if (room.players.black === socket) {
      room.players.black = null;
      changed = true;
    }
    if (room.players.white === socket) {
      room.players.white = null;
      changed = true;
    }
    if (room.pendingUndo && room.pendingUndo.requestedBy === role) {
      clearPendingUndo(room);
      changed = true;
    }

    if (room.gameStatus !== "finished") {
      syncRoomStatus(room);
      room.winner = null;
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
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function validatePlayerAction(room, socket) {
  if (!socket.roomId) return "请先加入房间。";
  const role = getRoleForSocket(room, socket);
  if (role !== "black" && role !== "white") {
    return "只有房间内两位玩家可以进行对局操作。";
  }
  if (getReadyPlayerCount(room) < 2) {
    return "请等待两位玩家都进入房间后再开始。";
  }
  if (room.gameStatus === "finished") {
    return "本局已结束。";
  }
  return null;
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
      sendError(socket, "消息格式无效。");
      return;
    }

    if (payload.type === "join") {
      if (socket.roomId) releaseSeat(socket);

      const roomId =
        typeof payload.roomId === "string" && payload.roomId.trim()
          ? payload.roomId.trim().slice(0, 24)
          : crypto.randomBytes(3).toString("hex");

      const room = ensureRoom(roomId);
      room.clients.add(socket);
      socket.roomId = roomId;
      assignSeat(room, socket);
      syncRoomStatus(room);
      socket.send(JSON.stringify(createRoomState(room, socket)));
      broadcastRoom(room, "房间状态已更新。");
      return;
    }

    if (!socket.roomId) {
      sendError(socket, "请先加入房间。");
      return;
    }

    const room = rooms.get(socket.roomId);
    if (!room) {
      sendError(socket, "房间不存在。");
      return;
    }

    const role = getRoleForSocket(room, socket);
    const opponentRole = getOpponentRole(role);

    if (payload.type === "move") {
      if (typeof payload.x !== "number" || typeof payload.y !== "number") {
        sendError(socket, "落子参数无效。");
        return;
      }
      const validationError = validatePlayerAction(room, socket);
      if (validationError) {
        sendError(socket, validationError);
        return;
      }
      if (role !== room.currentTurn) {
        sendError(socket, "还没轮到你。");
        return;
      }

      const x = Math.trunc(payload.x);
      const y = Math.trunc(payload.y);
      if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) {
        sendError(socket, "坐标超出棋盘范围。");
        return;
      }

      const result = applyMove(room.board, x, y, role);
      if (!result.valid) {
        sendError(socket, result.reason);
        return;
      }

      clearPendingUndo(room);
      room.board = result.board;
      room.currentTurn = opponentRole;
      room.moveCount += 1;
      room.lastMove = { type: "move", x, y, color: role, captured: result.captured };
      room.captures[role] += result.captured;
      room.consecutivePasses = 0;
      syncRoomStatus(room);
      pushHistory(room);
      broadcastRoom(room, result.captured > 0 ? `提子 ${result.captured} 颗。` : "落子成功。");
      return;
    }

    if (payload.type === "pass") {
      const validationError = validatePlayerAction(room, socket);
      if (validationError) {
        sendError(socket, validationError);
        return;
      }
      if (role !== room.currentTurn) {
        sendError(socket, "还没轮到你。");
        return;
      }

      clearPendingUndo(room);
      room.currentTurn = opponentRole;
      room.moveCount += 1;
      room.consecutivePasses += 1;
      room.lastMove = { type: "pass", color: role, captured: 0 };
      if (room.consecutivePasses >= 2) {
        room.gameStatus = "finished";
        room.winner = null;
      } else {
        syncRoomStatus(room);
      }
      pushHistory(room);
      broadcastRoom(
        room,
        room.gameStatus === "finished"
          ? "双方连续停一手，本局结束。"
          : `${role === "black" ? "黑方" : "白方"}选择停一手。`,
      );
      return;
    }

    if (payload.type === "resign") {
      const validationError = validatePlayerAction(room, socket);
      if (validationError) {
        sendError(socket, validationError);
        return;
      }

      clearPendingUndo(room);
      room.gameStatus = "finished";
      room.winner = opponentRole;
      room.lastMove = { type: "resign", color: role, captured: 0 };
      pushHistory(room);
      broadcastRoom(room, `${role === "black" ? "黑方" : "白方"}已认输。`);
      return;
    }

    if (payload.type === "requestUndo") {
      const validationError = validatePlayerAction(room, socket);
      if (validationError) {
        sendError(socket, validationError);
        return;
      }
      if (room.moveCount === 0 || room.history.length <= 1) {
        sendError(socket, "当前没有可悔的步骤。");
        return;
      }
      if (room.pendingUndo) {
        sendError(socket, "当前已有悔棋申请在等待回应。");
        return;
      }

      room.pendingUndo = { requestedBy: role, target: opponentRole };
      broadcastRoom(room, `${role === "black" ? "黑方" : "白方"}发起了悔棋申请。`);
      return;
    }

    if (payload.type === "respondUndo") {
      if (!room.pendingUndo) {
        sendError(socket, "当前没有待处理的悔棋申请。");
        return;
      }
      if (role !== room.pendingUndo.target) {
        sendError(socket, "只有对方可以回应这次悔棋申请。");
        return;
      }

      const accept = Boolean(payload.accept);
      const requestedBy = room.pendingUndo.requestedBy;
      clearPendingUndo(room);

      if (!accept) {
        broadcastRoom(room, "悔棋申请已被拒绝。");
        return;
      }

      if (room.history.length <= 1) {
        broadcastRoom(room, "没有可悔的步骤。");
        return;
      }

      room.history.pop();
      restoreSnapshot(room, room.history[room.history.length - 1]);
      broadcastRoom(room, `${requestedBy === "black" ? "黑方" : "白方"}的悔棋申请已被同意。`);
    }
  });

  socket.on("close", () => {
    releaseSeat(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Go MVP server listening on http://localhost:${PORT}`);
});
