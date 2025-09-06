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
    if (game.gameType === 'tic_tac_toe') { game.board = Array(9).fill(null); }
    if (game.gameType === 'memory_match') {
        const values = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
        values.sort(() => Math.random() - 0.5);
        game.board = values.map(val => ({ value: val, isFlipped: false, isMatched: false }));
        game.flippedIndices = [];
        game.playerPoints = { [game.players[0].id]: 0 };
    }
}

function startGame(game) {
    const [p1] = game.players;
    game.turn = p1.id;
    game.status = `It's ${p1.name}'s turn.`;
    if (game.gameType === 'memory_match' && game.players.length > 1) {
        game.playerPoints[game.players[1].id] = 0;
    }
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
    if (game.gameType === 'tic_tac_toe') handleTicTacToeMove(game, ws.id, move.index);
    if (game.gameType === 'memory_match') handleMemoryMatchMove(game, ws.id, move.index);
    checkMatchOver(game);
    broadcast(game.gameId, { type: 'gameState', game });
}

function handleTicTacToeMove(game, playerId, index) {
    if (game.board[index]) return;
    const playerIndex = game.players.findIndex(p => p.id === playerId);
    game.board[index] = playerIndex === 0 ? 'X' : 'O';
    const lines = [ [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6] ];
    if (lines.some(l => game.board[l[0]] && game.board[l[0]] === game.board[l[1]] && game.board[l[0]] === game.board[l[2]])) {
        endRound(game, game.players[playerIndex]);
    } else if (game.board.every(cell => cell)) {
        endRound(game, null);
    } else {
        switchTurn(game);
    }
}

function handleMemoryMatchMove(game, playerId, index) {
    if (game.board[index].isFlipped || game.flippedIndices.length >= 2) return;
    game.board[index].isFlipped = true;
    game.flippedIndices.push(index);
    if (game.flippedIndices.length === 2) {
        const [i1, i2] = game.flippedIndices;
        if (game.board[i1].value === game.board[i2].value) {
            game.board[i1].isMatched = true;
            game.board[i2].isMatched = true;
            game.playerPoints[playerId]++;
            game.flippedIndices = [];
            if (game.board.every(c => c.isMatched)) {
                const winner = game.playerPoints[game.players[0].id] > game.playerPoints[game.players[1].id] ? game.players[0] : game.players[1];
                endRound(game, winner);
            }
        } else {
            setTimeout(() => {
                game.board[i1].isFlipped = false;
                game.board[i2].isFlipped = false;
                game.flippedIndices = [];
                switchTurn(game);
                broadcast(game.gameId, { type: 'gameState', game });
            }, 1500);
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
    else if (p2 && game.matchScore[p2.id] >= WIN_SCORE) { game.gameOver = true; game.status = `${p2.name} wins the match!`; }
}

function switchTurn(game) {
    const currentPlayerIndex = game.players.findIndex(p => p.id === game.turn);
    const nextPlayer = game.players[1 - currentPlayerIndex];
    if(nextPlayer) {
        game.turn = nextPlayer.id;
        game.status = `It's ${nextPlayer.name}'s turn.`;
    }
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
