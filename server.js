const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
let games = {};
const WIN_SCORE = 3;

console.log(`Server starting on port ${PORT}...`);
wss.on('listening', () => console.log(`Server is listening!`));

wss.on('connection', ws => {
    ws.id = generateId();
    console.log(`Player ${ws.id} connected.`);
    ws.send(JSON.stringify({ type: 'init', playerId: ws.id }));
    ws.on('message', message => { try { routeMessage(ws, JSON.parse(message)); } catch (e) { console.error("Invalid JSON:", message); }});
    ws.on('close', () => handleDisconnect(ws));
    ws.on('error', (e) => console.error(`WS Error for ${ws.id}:`, e));
});

function routeMessage(ws, data) {
    const { type, gameId } = data;
    const handlers = {
        'create': () => handleCreateGame(ws, data.name, data.gameType),
        'join': () => handleJoinGame(ws, data.name, gameId),
        'move': () => handleMove(ws, gameId, data.move),
        'chat': () => broadcast(gameId, { type: 'chat', name: data.name, message: data.message }),
        'resetRound': () => resetRound(gameId),
        'leave': () => handleDisconnect(ws),
    };
    if (handlers[type]) handlers[type]();
}

function handleCreateGame(ws, name, gameType) {
    const gameId = generateId();
    ws.gameId = gameId;
    games[gameId] = { gameId, gameType, players: [{ id: ws.id, name }], status: 'Waiting...', roundOver: false, gameOver: false };
    initializeGame(games[gameId]);
    ws.send(JSON.stringify({ type: 'created', gameId }));
}

function handleJoinGame(ws, name, gameId) {
    const game = games[gameId];
    if (game && game.players.length < 2) {
        ws.gameId = gameId;
        game.players.push({ id: ws.id, name });
        game.matchScore = { [game.players[0].id]: 0, [game.players[1].id]: 0 };
        startGame(game);
    } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Game not found or full.' }));
    }
}

function initializeGame(game) {
    game.roundOver = false;
    if (game.gameType === 'checkers') { game.board = [ [0, 2, 0, 2, 0, 2, 0, 2], [2, 0, 2, 0, 2, 0, 2, 0], [0, 2, 0, 2, 0, 2, 0, 2], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 1, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 0, 1, 0, 1, 0], ]; }
    if (game.gameType === 'dots_and_boxes') {
        const size = 4;
        game.board = { size, hLines: Array(size + 1).fill(null).map(() => Array(size).fill(0)), vLines: Array(size).fill(null).map(() => Array(size + 1).fill(0)), boxes: Array(size).fill(null).map(() => Array(size).fill(0)), };
    }
}

function startGame(game) {
    const [p1, p2] = game.players;
    game.turn = p1.id;
    game.status = `It's ${p1.name}'s turn.`;
    broadcast(game.gameId, { type: 'gameState', game });
}

function resetRound(gameId) {
    const game = games[gameId];
    if (!game || game.gameOver) return;
    initializeGame(game);
    startGame(game);
}

function handleMove(ws, gameId, move) {
    const game = games[gameId];
    if (!game || game.roundOver || game.gameOver || game.turn !== ws.id) return;
    let completedBox = false;
    if (game.gameType === 'checkers') handleCheckersMove(game, ws.id, move);
    if (game.gameType === 'dots_and_boxes') completedBox = handleDotsAndBoxesMove(game, ws.id, move);
    if (!completedBox) switchTurn(game);
    checkRoundOver(game, ws.id);
    checkMatchOver(game);
    broadcast(game.gameId, { type: 'gameState', game });
}

function handleDotsAndBoxesMove(game, playerId, move) {
    const { type, r, c } = move;
    const playerNum = game.players.findIndex(p => p.id === playerId) + 1;
    let boxCompleted = false;
    if (type === 'h' && game.board.hLines[r][c] === 0) { game.board.hLines[r][c] = playerNum; }
    else if (type === 'v' && game.board.vLines[r][c] === 0) { game.board.vLines[r][c] = playerNum; }
    else return true;
    for (let br = 0; br < game.board.size; br++) {
        for (let bc = 0; bc < game.board.size; bc++) {
            if (game.board.boxes[br][bc] === 0 && game.board.hLines[br][bc] && game.board.hLines[br + 1][bc] && game.board.vLines[br][bc] && game.board.vLines[br][bc + 1]) {
                game.board.boxes[br][bc] = playerNum;
                boxCompleted = true;
            }
        }
    }
    return boxCompleted;
}

function handleCheckersMove(game, playerId, move) {
    const { from, to } = move; const piece = game.board[from.row][from.col]; const playerNum = game.players.findIndex(p => p.id === playerId) + 1;
    if (piece === 0 || (piece % 11 !== playerNum)) return;
    const dy = to.row - from.row; const dx = to.col - from.col; const isKing = piece > 10;
    if (!isKing && ((playerNum === 1 && dy > 0) || (playerNum === 2 && dy < 0))) return;
    if (Math.abs(dy) === 2 && Math.abs(dx) === 2) {
        const jumpedRow = from.row + dy / 2; const jumpedCol = from.col + dx / 2; const jumpedPiece = game.board[jumpedRow][jumpedCol];
        if (jumpedPiece !== 0 && jumpedPiece % 11 !== playerNum) {
            game.board[to.row][to.col] = piece; game.board[from.row][from.col] = 0; game.board[jumpedRow][jumpedCol] = 0;
            if ((to.row === 0 && playerNum === 1) || (to.row === 7 && playerNum === 2)) game.board[to.row][to.col] = playerNum * 11;
        }
    } else if (Math.abs(dy) === 1 && Math.abs(dx) === 1) {
        if (game.board[to.row][to.col] === 0) {
            game.board[to.row][to.col] = piece; game.board[from.row][from.col] = 0;
            if ((to.row === 0 && playerNum === 1) || (to.row === 7 && playerNum === 2)) game.board[to.row][to.col] = playerNum * 11;
        }
    }
}

function checkRoundOver(game, playerId) {
    if (game.gameType === 'checkers') {
        const playerNum = game.players.findIndex(p => p.id === playerId) + 1;
        const opponentNum = playerNum === 1 ? 2 : 1; let opponentPieces = 0;
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (game.board[r][c] % 11 === opponentNum) opponentPieces++;
        if (opponentPieces === 0) endRound(game, game.players[playerNum - 1]);
    }
    if (game.gameType === 'dots_and_boxes') {
        let totalBoxes = 0; game.board.boxes.forEach(row => row.forEach(box => { if (box !== 0) totalBoxes++; }));
        if (totalBoxes === game.board.size * game.board.size) {
            let p1Boxes = 0; let p2Boxes = 0;
            game.board.boxes.forEach(row => row.forEach(box => { if (box === 1) p1Boxes++; else if (box === 2) p2Boxes++; }));
            if (p1Boxes > p2Boxes) endRound(game, game.players[0]);
            else if (p2Boxes > p1Boxes) endRound(game, game.players[1]);
            else endRound(game, null);
        }
    }
}

function endRound(game, winner) {
    game.roundOver = true;
    if (winner) { game.status = `${winner.name} wins the round!`; game.matchScore[winner.id]++; }
    else { game.status = "It's a draw!"; }
}

function checkMatchOver(game) {
    const [p1, p2] = game.players;
    if (game.matchScore[p1.id] >= WIN_SCORE) { game.gameOver = true; game.status = `${p1.name} wins the match!`; }
    else if (game.matchScore[p2.id] >= WIN_SCORE) { game.gameOver = true; game.status = `${p2.name} wins the match!`; }
}

function switchTurn(game) {
    const currentPlayerIndex = game.players.findIndex(p => p.id === game.turn);
    const nextPlayer = game.players[1 - currentPlayerIndex];
    game.turn = nextPlayer.id;
    game.status = `It's ${nextPlayer.name}'s turn.`;
}

function handleDisconnect(ws) {
    const gameId = ws.gameId;
    if (gameId && games[gameId]) {
        if (games[gameId].players.length <= 2) { broadcast(gameId, { type: 'opponentLeft' }); delete games[gameId]; }
    }
}
function generateId() { return Math.random().toString(36).substring(2, 9); }
function broadcast(gameId, data) {
    if (!games[gameId]) return;
    games[gameId].players.forEach(player => {
        wss.clients.forEach(client => {
            if (client.id === player.id && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    });
}
