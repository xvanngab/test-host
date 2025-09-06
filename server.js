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
    if (game.gameType === 'battleship') {
        game.boards = [placeShips(), placeShips()];
        game.ships = [getShipLocations(game.boards[0]), getShipLocations(game.boards[1])];
    }
}

function startGame(game) {
    const [p1] = game.players;
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
    if (game.gameType === 'tic_tac_toe') handleTicTacToeMove(game, ws.id, move.index);
    if (game.gameType === 'battleship') handleBattleshipMove(game, ws.id, move.index);
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

function handleBattleshipMove(game, playerId, index) {
    const playerIndex = game.players.findIndex(p => p.id === playerId);
    const opponentIndex = 1 - playerIndex;
    if(game.boards[opponentIndex][index] === 'hit' || game.boards[opponentIndex][index] === 'miss') return;
    if(game.ships[opponentIndex].includes(index)){
        game.boards[opponentIndex][index] = 'hit';
        game.status = 'A hit!';
    } else {
        game.boards[opponentIndex][index] = 'miss';
        game.status = 'A miss!';
    }
    const opponentShipsSunk = game.ships[opponentIndex].every(shipIndex => game.boards[opponentIndex][shipIndex] === 'hit');
    if(opponentShipsSunk){
        endRound(game, game.players[playerIndex]);
    } else {
        switchTurn(game);
    }
}

function endRound(game, winner) {
    game.roundOver = true;
    if (winner) { game.status = `${winner.name} wins the round!`; game.matchScore[winner.id]++; }
    else { game.status = "It's a draw!"; }
}

function checkMatchOver(game) {
    const [p1, p2] = game.players;
    if (p2 && game.matchScore[p1.id] >= WIN_SCORE) { game.gameOver = true; game.status = `${p1.name} wins the match!`; }
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

function placeShips() {
    const board = Array(100).fill('');
    const ships = [5, 4, 3, 3, 2];
    ships.forEach(size => {
        let placed = false;
        while(!placed){
            const isHorizontal = Math.random() < 0.5;
            const start = Math.floor(Math.random() * 100);
            const row = Math.floor(start / 10);
            const col = start % 10;
            if(canPlace(board, size, row, col, isHorizontal)){
                for(let i=0; i<size; i++){
                    board[start + (isHorizontal ? i : i*10)] = 'ship';
                }
                placed = true;
            }
        }
    });
    return board;
}

function canPlace(board, size, row, col, isHorizontal) {
    if (isHorizontal) {
        if (col + size > 10) return false;
        for (let i = 0; i < size; i++) if (board[row * 10 + col + i]) return false;
    } else {
        if (row + size > 10) return false;
        for (let i = 0; i < size; i++) if (board[(row + i) * 10 + col]) return false;
    }
    return true;
}

function getShipLocations(board){
    return board.map((val, i) => val === 'ship' ? i : -1).filter(i => i !== -1);
        }
