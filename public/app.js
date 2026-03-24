const BOARD_SIZE = 9;
const EMPTY = null;

const elements = {
  joinForm: document.querySelector("#join-form"),
  roomInput: document.querySelector("#room-input"),
  roomLabel: document.querySelector("#room-label"),
  roleLabel: document.querySelector("#role-label"),
  turnLabel: document.querySelector("#turn-label"),
  playersLabel: document.querySelector("#players-label"),
  messageLabel: document.querySelector("#message-label"),
  lastMoveLabel: document.querySelector("#last-move-label"),
  board: document.querySelector("#board"),
};

const state = {
  roomId: "",
  yourRole: "viewer",
  currentTurn: "black",
  board: Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => EMPTY),
  ),
  readyPlayers: 0,
  lastMove: null,
};

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${protocol}//${window.location.host}`);

function roleText(role) {
  if (role === "black") return "黑方";
  if (role === "white") return "白方";
  return "旁观";
}

function isStarPoint(x, y) {
  if (BOARD_SIZE !== 9) {
    return false;
  }
  return (
    (x === 2 && y === 2) ||
    (x === 2 && y === 6) ||
    (x === 6 && y === 2) ||
    (x === 6 && y === 6) ||
    (x === 4 && y === 4)
  );
}

function renderBoard() {
  elements.board.innerHTML = "";
  elements.board.style.setProperty("--board-size", BOARD_SIZE);

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell";
      button.dataset.x = String(x);
      button.dataset.y = String(y);
      button.disabled = !state.roomId;

      if (x === 0) button.classList.add("edge-left");
      if (x === BOARD_SIZE - 1) button.classList.add("edge-right");
      if (y === 0) button.classList.add("edge-top");
      if (y === BOARD_SIZE - 1) button.classList.add("edge-bottom");
      if (isStarPoint(x, y)) {
        button.classList.add("star-point");
        const starPointDot = document.createElement("span");
        starPointDot.className = "star-point-dot";
        button.appendChild(starPointDot);
      }

      const stone = state.board[y][x];
      if (stone) {
        const stoneEl = document.createElement("span");
        stoneEl.className = `stone ${stone}`;
        button.appendChild(stoneEl);
      }

      if (
        state.lastMove &&
        state.lastMove.x === x &&
        state.lastMove.y === y &&
        stone
      ) {
        button.classList.add("last-move");
      }

      button.addEventListener("click", () => {
        socket.send(JSON.stringify({ type: "move", x, y }));
      });

      elements.board.appendChild(button);
    }
  }
}

function renderStatus() {
  elements.roomLabel.textContent = state.roomId || "未加入";
  elements.roleLabel.textContent = roleText(state.yourRole);
  elements.turnLabel.textContent = roleText(state.currentTurn);
  elements.playersLabel.textContent = `${state.readyPlayers} / 2`;
  elements.lastMoveLabel.textContent = state.lastMove
    ? `最近一步：${roleText(state.lastMove.color)} 落在 (${state.lastMove.x + 1}, ${state.lastMove.y + 1})${
        state.lastMove.captured ? `，提子 ${state.lastMove.captured} 颗` : ""
      }`
    : "最近一步：暂无";
}

function updateState(next) {
  state.roomId = next.roomId;
  state.yourRole = next.yourRole;
  state.currentTurn = next.currentTurn;
  state.board = next.board;
  state.readyPlayers = next.readyPlayers;
  state.lastMove = next.lastMove;
  elements.messageLabel.textContent = next.message || "房间已连接。";
  renderStatus();
  renderBoard();
}

elements.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const roomId = elements.roomInput.value.trim();
  socket.send(JSON.stringify({ type: "join", roomId }));
});

socket.addEventListener("open", () => {
  const presetRoom = new URLSearchParams(window.location.search).get("room");
  if (presetRoom) {
    elements.roomInput.value = presetRoom;
    socket.send(JSON.stringify({ type: "join", roomId: presetRoom }));
  }
});

socket.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);

  if (payload.type === "state") {
    updateState(payload);
    return;
  }

  if (payload.type === "error") {
    elements.messageLabel.textContent = payload.message;
  }
});

socket.addEventListener("close", () => {
  elements.messageLabel.textContent = "连接已断开，请刷新页面重试。";
});

renderStatus();
renderBoard();
