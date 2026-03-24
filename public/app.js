const BOARD_SIZE = 9;
const EMPTY = null;
const VIEWBOX_SIZE = 1000;
const BOARD_PADDING = 80;
const GRID_SPAN = VIEWBOX_SIZE - BOARD_PADDING * 2;
const STEP = GRID_SPAN / (BOARD_SIZE - 1);
const STONE_RADIUS = STEP * 0.36;
const HIT_RADIUS = STEP * 0.46;
const SVG_NS = "http://www.w3.org/2000/svg";

const elements = {
  joinForm: document.querySelector("#join-form"),
  roomInput: document.querySelector("#room-input"),
  roomLabel: document.querySelector("#room-label"),
  roleLabel: document.querySelector("#role-label"),
  statusLabel: document.querySelector("#status-label"),
  turnLabel: document.querySelector("#turn-label"),
  playersLabel: document.querySelector("#players-label"),
  moveCountLabel: document.querySelector("#move-count-label"),
  blackCapturesLabel: document.querySelector("#black-captures-label"),
  whiteCapturesLabel: document.querySelector("#white-captures-label"),
  passCountLabel: document.querySelector("#pass-count-label"),
  messageLabel: document.querySelector("#message-label"),
  lastMoveLabel: document.querySelector("#last-move-label"),
  undoLabel: document.querySelector("#undo-label"),
  board: document.querySelector("#board"),
  passButton: document.querySelector("#pass-button"),
  undoButton: document.querySelector("#undo-button"),
  undoResponseButton: document.querySelector("#undo-response-button"),
  undoRejectButton: document.querySelector("#undo-reject-button"),
  resignButton: document.querySelector("#resign-button"),
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
  moveCount: 0,
  captures: { black: 0, white: 0 },
  consecutivePasses: 0,
  gameStatus: "waiting",
  winner: null,
  pendingUndo: null,
};

const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${protocol}//${window.location.host}`);

function roleText(role) {
  if (role === "black") return "黑方";
  if (role === "white") return "白方";
  return "旁观";
}

function createSvgElement(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function isStarPoint(x, y) {
  if (BOARD_SIZE !== 9) return false;
  return (
    (x === 2 && y === 2) ||
    (x === 2 && y === 6) ||
    (x === 6 && y === 2) ||
    (x === 6 && y === 6) ||
    (x === 4 && y === 4)
  );
}

function coord(index) {
  return BOARD_PADDING + index * STEP;
}

function isPlayerRole(role) {
  return role === "black" || role === "white";
}

function isMyTurn() {
  return state.yourRole === state.currentTurn;
}

function getStatusText() {
  if (state.gameStatus === "finished") {
    return state.winner ? `${roleText(state.winner)}胜` : "对局结束";
  }
  if (state.readyPlayers < 2) return "等待对手";
  return "对局进行中";
}

function getLastMoveText() {
  if (!state.lastMove) return "最近一步：暂无";
  if (state.lastMove.type === "pass") {
    return `最近一步：${roleText(state.lastMove.color)}跳过一手`;
  }
  if (state.lastMove.type === "resign") {
    return `最近一步：${roleText(state.lastMove.color)}认输`;
  }
  return `最近一步：${roleText(state.lastMove.color)} 落在 (${state.lastMove.x + 1}, ${state.lastMove.y + 1})${
    state.lastMove.captured ? `，提子 ${state.lastMove.captured} 颗` : ""
  }`;
}

function getUndoText() {
  if (!state.pendingUndo) return "悔棋状态：暂无";
  return `悔棋状态：${roleText(state.pendingUndo.requestedBy)}已发起悔棋申请`;
}

function renderBoard() {
  elements.board.innerHTML = "";

  const svg = createSvgElement("svg", {
    viewBox: `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`,
    class: "board-svg",
    "aria-label": "Go board",
  });

  const defs = createSvgElement("defs");
  const woodGradient = createSvgElement("linearGradient", {
    id: "woodGradient",
    x1: "0%",
    y1: "0%",
    x2: "100%",
    y2: "100%",
  });
  woodGradient.appendChild(createSvgElement("stop", { offset: "0%", "stop-color": "#d7ab62" }));
  woodGradient.appendChild(createSvgElement("stop", { offset: "100%", "stop-color": "#be8c47" }));

  const blackGradient = createSvgElement("radialGradient", {
    id: "blackStone",
    cx: "30%",
    cy: "28%",
    r: "70%",
  });
  blackGradient.appendChild(createSvgElement("stop", { offset: "0%", "stop-color": "#57514c" }));
  blackGradient.appendChild(createSvgElement("stop", { offset: "100%", "stop-color": "#1c1917" }));

  const whiteGradient = createSvgElement("radialGradient", {
    id: "whiteStone",
    cx: "30%",
    cy: "28%",
    r: "70%",
  });
  whiteGradient.appendChild(createSvgElement("stop", { offset: "0%", "stop-color": "#ffffff" }));
  whiteGradient.appendChild(createSvgElement("stop", { offset: "100%", "stop-color": "#f0e8dc" }));

  defs.appendChild(woodGradient);
  defs.appendChild(blackGradient);
  defs.appendChild(whiteGradient);
  svg.appendChild(defs);

  svg.appendChild(
    createSvgElement("rect", {
      x: 0,
      y: 0,
      width: VIEWBOX_SIZE,
      height: VIEWBOX_SIZE,
      rx: 34,
      ry: 34,
      fill: "url(#woodGradient)",
    }),
  );

  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const p = coord(i);
    svg.appendChild(createSvgElement("line", {
      x1: BOARD_PADDING, y1: p, x2: VIEWBOX_SIZE - BOARD_PADDING, y2: p, class: "grid-line",
    }));
    svg.appendChild(createSvgElement("line", {
      x1: p, y1: BOARD_PADDING, x2: p, y2: VIEWBOX_SIZE - BOARD_PADDING, class: "grid-line",
    }));
  }

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const cx = coord(x);
      const cy = coord(y);

      if (isStarPoint(x, y)) {
        svg.appendChild(createSvgElement("circle", {
          cx, cy, r: STEP * 0.08, class: "star-point-dot",
        }));
      }

      const stone = state.board[y][x];
      if (stone) {
        svg.appendChild(createSvgElement("circle", {
          cx,
          cy,
          r: STONE_RADIUS,
          class: "stone",
          fill: stone === "black" ? "url(#blackStone)" : "url(#whiteStone)",
        }));
        if (state.lastMove && state.lastMove.x === x && state.lastMove.y === y) {
          svg.appendChild(createSvgElement("circle", {
            cx, cy, r: STEP * 0.09, class: "last-move-dot",
          }));
        }
      }

      const hit = createSvgElement("circle", {
        cx, cy, r: HIT_RADIUS, class: "hit-area",
      });
      if (!(state.gameStatus === "playing" && isPlayerRole(state.yourRole) && isMyTurn())) {
        hit.classList.add("disabled");
      }
      hit.addEventListener("click", () => {
        socket.send(JSON.stringify({ type: "move", x, y }));
      });
      svg.appendChild(hit);
    }
  }

  elements.board.appendChild(svg);
}

function renderControls() {
  const canOperate = isPlayerRole(state.yourRole) && state.readyPlayers === 2 && state.gameStatus !== "finished";
  elements.passButton.disabled = !(canOperate && isMyTurn());
  elements.resignButton.disabled = !canOperate;
  elements.undoButton.disabled = !(canOperate && !state.pendingUndo && state.moveCount > 0);

  const waitingMyResponse = state.pendingUndo && state.pendingUndo.target === state.yourRole;
  elements.undoResponseButton.hidden = !waitingMyResponse;
  elements.undoRejectButton.hidden = !waitingMyResponse;
  elements.undoResponseButton.disabled = !waitingMyResponse;
  elements.undoRejectButton.disabled = !waitingMyResponse;
}

function renderStatus() {
  elements.roomLabel.textContent = state.roomId || "未加入";
  elements.roleLabel.textContent = roleText(state.yourRole);
  elements.statusLabel.textContent = getStatusText();
  elements.turnLabel.textContent = roleText(state.currentTurn);
  elements.playersLabel.textContent = `${state.readyPlayers} / 2`;
  elements.moveCountLabel.textContent = String(state.moveCount);
  elements.blackCapturesLabel.textContent = String(state.captures.black);
  elements.whiteCapturesLabel.textContent = String(state.captures.white);
  elements.passCountLabel.textContent = String(state.consecutivePasses);
  elements.lastMoveLabel.textContent = getLastMoveText();
  elements.undoLabel.textContent = getUndoText();
  renderControls();
}

function updateState(next) {
  state.roomId = next.roomId;
  state.yourRole = next.yourRole;
  state.currentTurn = next.currentTurn;
  state.board = next.board;
  state.readyPlayers = next.readyPlayers;
  state.lastMove = next.lastMove;
  state.moveCount = next.moveCount;
  state.captures = next.captures;
  state.consecutivePasses = next.consecutivePasses;
  state.gameStatus = next.gameStatus;
  state.winner = next.winner;
  state.pendingUndo = next.pendingUndo;
  elements.messageLabel.textContent = next.message || "房间已连接。";
  renderStatus();
  renderBoard();
}

elements.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  socket.send(JSON.stringify({ type: "join", roomId: elements.roomInput.value.trim() }));
});

elements.passButton.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "pass" }));
});

elements.undoButton.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "requestUndo" }));
});

elements.undoResponseButton.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "respondUndo", accept: true }));
});

elements.undoRejectButton.addEventListener("click", () => {
  socket.send(JSON.stringify({ type: "respondUndo", accept: false }));
});

elements.resignButton.addEventListener("click", () => {
  if (window.confirm("确认认输吗？")) {
    socket.send(JSON.stringify({ type: "resign" }));
  }
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
