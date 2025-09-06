// --- V3 WebSocket Server: Match Logic, New Games, Emojis ---

const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
let games = {}; // In-memory storage for active games

const WIN_SCORE = 3; // Game match is first to 3 wins

console.log(`✅ Server starting on port ${PORT}...`);
wss.on('listening', () => console.log(`✅ Server is listening!`));

wss.on('connection', ws => {
    ws.id = generateId();
    console.log(`Player ${ws.id} connected.`);
    ws.send(JSON.stringify({ type: 'init', playerId: ws.id }));

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            console.log(`Received:`, data); // Log for debugging
            routeMessage(ws, data);
        } catch (e) { console.error("Invalid JSON:", message); }
    });
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

// --- Game Initialization & State ---
function handleCreateGame(ws, name, gameType) {
    const gameId = generateId();
    ws.gameId = gameId;
    games[gameId] = {
        gameId, gameType, players: [{ id: ws.id, name, score: 0 }],
        status: 'Waiting for an opponent...',
        roundOver: false, gameOver: false,
    };
    initializeGame(games[gameId]);
    ws.send(JSON.stringify({ type: 'created', gameId }));
}

function handleJoinGame(ws, name, gameId) {
    const game = games[gameId];
    if (game && game.players.length < 2) {
        ws.gameId = gameId;
        game.players.push({ id: ws.id, name, score: 0 });
        game.matchScore = { [game.players[0].id]: 0, [game.players[1].id]: 0 };
        startGame(game);
    } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Game not found or is full.' }));
    }
}

function initializeGame(game) {
    game.roundOver = false;
    // Specific initializations
    if (game.gameType === 'checkers') {
        game.board = [
            [0, 2, 0, 2, 0, 2, 0, 2], [2, 0, 2, 0, 2, 0, 2, 0], [0, 2, 0, 2, 0, 2, 0, 2],
            [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0],
            [1, 0, 1, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 0, 1, 0, 1, 0],
        ]; // 1=p1, 2=p2, 11=p1 king, 22=p2 king
    }
    // Add other game inits as before...
}

function startGame(game) {
    const [p1, p2] = game.players;
    game.turn = p1.id; // P1 always starts first round
    game.status = `It's ${p1.name}'s turn.`;
    broadcast(game.gameId, { type: 'gameState', game });
}

function resetRound(gameId) {
    const game = games[gameId];
    if (!game || game.gameOver) return;
    initializeGame(game);
    startGame(game);
}

// --- Universal Move Handler ---
function handleMove(ws, gameId, move) {
    const game = games[gameId];
    if (!game || game.roundOver || game.gameOver || game.turn !== ws.id) return;
    
    // Delegate to game-specific handlers
    if (game.gameType === 'checkers') handleCheckersMove(game, ws.id, move);
    // Add other game handlers...
    
    checkMatchOver(game);
    broadcast(game.gameId, { type: 'gameState', game });
}

// --- Checkers Move Logic ---
function handleCheckersMove(game, playerId, move) {
    const { from, to } = move;
    const piece = game.board[from.row][from.col];
    const playerNum = game.players.findIndex(p => p.id === playerId) + 1;

    // Basic Validation
    if (piece === 0 || (piece !== playerNum && piece !== playerNum * 11)) return; // Not their piece

    const dy = to.row - from.row;
    const dx = to.col - from.col;
    const isKing = piece > 10;
    
    // Check direction
    if (!isKing) {
        if ((playerNum === 1 && dy > 0) || (playerNum === 2 && dy < 0)) return; // Wrong direction
    }
    
    // Check if it's a jump
    if (Math.abs(dy) === 2 && Math.abs(dx) === 2) {
        const jumpedRow = from.row + dy / 2;
        const jumpedCol = from.col + dx / 2;
        const jumpedPiece = game.board[jumpedRow][jumpedCol];
        if (jumpedPiece !== 0 && jumpedPiece % 11 !== playerNum) { // Must jump opponent
            game.board[to.row][to.col] = piece;
            game.board[from.row][from.col] = 0;
            game.board[jumpedRow][jumpedCol] = 0;
            // Kinging
            if ((to.row === 0 && playerNum === 1) || (to.row === 7 && playerNum === 2)) {
                game.board[to.row][to.col] = playerNum * 11;
            }
            // Check for another jump, otherwise switch turns
            // For simplicity, we are not implementing multi-jumps in one turn.
            switchTurn(game);
        }
    }
    // Check if it's a simple move
    else if (Math.abs(dy) === 1 && Math.abs(dx) === 1) {
        if (game.board[to.row][to.col] === 0) { // Can only move to empty square
            game.board[to.row][to.col] = piece;
            game.board[from.row][from.col] = 0;
            // Kinging
            if ((to.row === 0 && playerNum === 1) || (to.row === 7 && playerNum === 2)) {
                game.board[to.row][to.col] = playerNum * 11;
            }
            switchTurn(game);
        }
    }
    // Win condition check (simplified)
    const opponentNum = playerNum === 1 ? 2 : 1;
    let opponentPieces = 0;
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(game.board[r][c] === opponentNum || game.board[r][c] === opponentNum*11) opponentPieces++;
    if(opponentPieces === 0) {
        endRound(game, game.players[playerNum-1]);
    }
}

// --- Round/Match End Logic ---
function endRound(game, winner) {
    game.roundOver = true;
    if (winner) {
        game.status = `${winner.name} wins the round!`;
        game.matchScore[winner.id]++;
    } else {
        game.status = "It's a draw!";
    }
}

function checkMatchOver(game) {
    const [p1, p2] = game.players;
    if (game.matchScore[p1.id] >= WIN_SCORE) {
        game.gameOver = true;
        game.status = `${p1.name} wins the match!`;
    } else if (game.matchScore[p2.id] >= WIN_SCORE) {
        game.gameOver = true;
        game.status = `${p2.name} wins the match!`;
    }
}

function switchTurn(game) {
    const currentPlayerIndex = game.players.findIndex(p => p.id === game.turn);
    const nextPlayer = game.players[1 - currentPlayerIndex];
    game.turn = nextPlayer.id;
    game.status = `It's ${nextPlayer.name}'s turn.`;
}

// --- Utilities ---
function handleDisconnect(ws) {
    console.log(`Player ${ws.id} disconnected.`);
    const gameId = ws.gameId;
    if (gameId && games[gameId]) {
        if (games[gameId].players.length <= 2) {
            broadcast(gameId, { type: 'opponentLeft' });
            delete games[gameId];
            console.log(`Game ${gameId} closed.`);
        }
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
