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
        'create': () => handleCreateGame(ws, data.gameType),
        'join': () => handleJoinGame(ws, gameId),
        'move': () => handleMove(ws, gameId, data.move),
        'resetRound': () => resetRound(gameId),
        'leave': () => handleDisconnect(ws),
    };
    if (handlers[type]) handlers[type]();
}

function handleCreateGame(ws, gameType) {
    const gameId = generateId();
    ws.gameId = gameId;
    games[gameId] = { gameId, gameType, players: [{ id: ws.id, name: 'Player 1' }], status: 'Waiting...', roundOver: false, gameOver: false };
    initializeGame(games[gameId]);
    ws.send(JSON.stringify({ type: 'created', gameId }));
}

function handleJoinGame(ws, gameId) {
    const game = games[gameId];
    if (game && game.players.length < 2) {
        ws.gameId = gameId;
        game.players.push({ id: ws.id, name: 'Player 2' });
        game.matchScore = { [game.players[0].id]: 0, [game.players[1].id]: 0 };
        startGame(game);
    } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Game not found or full.' }));
    }
}

function initializeGame(game) {
    game.roundOver = false;
    game.winnerId = null;
    if (game.gameType === 'tic_tac_toe') { game.board = Array(9).fill(null); }
    if (game.gameType === 'connect_four') { game.board = Array(6).fill(null).map(() => Array(7).fill(null)); }
    if (game.gameType === 'checkers') { game.board = [ [0, 2, 0, 2, 0, 2, 0, 2], [2, 0, 2, 0, 2, 0, 2, 0], [0, 2, 0, 2, 0, 2, 0, 2], [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 1, 0, 1, 0, 1, 0], [0, 1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 0, 1, 0, 1, 0], ]; }
    if (game.gameType === 'battleship') { game.boards = [placeShips(), placeShips()]; game.ships = [getShipLocations(game.boards[0]), getShipLocations(game.boards[1])]; }
    if (game.gameType === 'rock_paper_scissors') { game.moves = {}; }
    if (game.gameType === 'memory_match') { const v = ['A','B','C','D','E','F','G','H','A','B','C','D','E','F','G','H']; v.sort(()=>Math.random()-0.5); game.board=v.map(val=>({value:val,isFlipped:false,isMatched:false})); game.flippedIndices = []; if (game.players.length > 0) game.playerPoints = { [game.players[0].id]: 0 }; }
}

function startGame(game) {
    const [p1] = game.players;
    game.turn = p1.id;
    game.status = `It's ${p1.name}'s turn.`;
    if (game.gameType === 'rock_paper_scissors' && game.players.length > 1) { game.status = 'Both players, make your move!'; }
    if (game.gameType === 'memory_match' && game.players.length > 1) { game.playerPoints[game.players[1].id] = 0; }
    broadcast(game.gameId, { type: 'gameState', game });
}

function resetRound(gameId) { const game = games[gameId]; if (!game || game.gameOver) return; initializeGame(game); startGame(game); }

function handleMove(ws, gameId, move) {
    const game = games[gameId];
    if (!game || game.roundOver || game.gameOver || (game.turn !== ws.id && game.gameType !== 'rock_paper_scissors')) return;
    if (game.gameType === 'tic_tac_toe') handleTicTacToeMove(game, ws.id, move.index);
    if (game.gameType === 'connect_four') handleConnectFourMove(game, ws.id, move.column);
    if (game.gameType === 'checkers') handleCheckersMove(game, ws.id, move);
    if (game.gameType === 'battleship') handleBattleshipMove(game, ws.id, move.index);
    if (game.gameType === 'rock_paper_scissors') handleRpsMove(game, ws.id, move.choice);
    if (game.gameType === 'memory_match') handleMemoryMatchMove(game, ws.id, move.index);
    checkMatchOver(game);
    broadcast(game.gameId, { type: 'gameState', game });
}

function handleTicTacToeMove(game, playerId, index) { if (game.board[index]) return; const playerIndex = game.players.findIndex(p => p.id === playerId); game.board[index] = playerIndex === 0 ? 'X' : 'O'; const lines = [ [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6] ]; if (lines.some(l => game.board[l[0]] && game.board[l[0]] === game.board[l[1]] && game.board[l[0]] === game.board[l[2]])) { endRound(game, game.players[playerIndex]); } else if (game.board.every(cell => cell)) { endRound(game, null); } else { switchTurn(game); } }
function handleConnectFourMove(game, playerId, col) { const playerIndex = game.players.findIndex(p => p.id === playerId); const piece = playerIndex === 0 ? 'player1' : 'player2'; for (let row = 5; row >= 0; row--) { if (!game.board[row][col]) { game.board[row][col] = piece; if (checkWin(game.board, 'connect_four')) { endRound(game, game.players[playerIndex]); } else { switchTurn(game); } return; } } }
function handleCheckersMove(game, playerId, move) { const { from, to } = move; const piece = game.board[from.row][from.col]; const playerNum = game.players.findIndex(p => p.id === playerId) + 1; if (piece === 0 || (piece % 11 !== playerNum)) return; const dy = to.row - from.row; const dx = to.col - from.col; const isKing = piece > 10; if (!isKing && ((playerNum === 1 && dy > 0) || (playerNum === 2 && dy < 0))) return; if (Math.abs(dy) === 2 && Math.abs(dx) === 2) { const jumpedRow = from.row + dy / 2; const jumpedCol = from.col + dx / 2; const jumpedPiece = game.board[jumpedRow][jumpedCol]; if (jumpedPiece !== 0 && jumpedPiece % 11 !== playerNum) { game.board[to.row][to.col] = piece; game.board[from.row][from.col] = 0; game.board[jumpedRow][jumpedCol] = 0; if ((to.row === 0 && playerNum === 1) || (to.row === 7 && playerNum === 2)) game.board[to.row][to.col] = playerNum * 11; switchTurn(game); } } else if (Math.abs(dy) === 1 && Math.abs(dx) === 1) { if (game.board[to.row][to.col] === 0) { game.board[to.row][to.col] = piece; game.board[from.row][from.col] = 0; if ((to.row === 0 && playerNum === 1) || (to.row === 7 && playerNum === 2)) game.board[to.row][to.col] = playerNum * 11; switchTurn(game); } } const opponentNum = playerNum === 1 ? 2 : 1; let opponentPieces = 0; for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(game.board[r][c] % 11 === opponentNum) opponentPieces++; if(opponentPieces === 0) { endRound(game, game.players[playerNum-1]); } }
function handleBattleshipMove(game, playerId, index) { const playerIndex = game.players.findIndex(p => p.id === playerId); const opponentIndex = 1 - playerIndex; if(game.boards[opponentIndex][index] === 'hit' || game.boards[opponentIndex][index] === 'miss') return; if(game.ships[opponentIndex].includes(index)){ game.boards[opponentIndex][index] = 'hit'; game.status = 'A hit!'; } else { game.boards[opponentIndex][index] = 'miss'; game.status = 'A miss!'; } const opponentShipsSunk = game.ships[opponentIndex].every(shipIndex => game.boards[opponentIndex][shipIndex] === 'hit'); if(opponentShipsSunk){ endRound(game, game.players[playerIndex]); } else { switchTurn(game); } }
function handleRpsMove(game, playerId, choice) { game.moves[playerId] = choice; const [p1, p2] = game.players; if (game.moves[p1.id] && game.moves[p2.id]) { const move1 = game.moves[p1.id], move2 = game.moves[p2.id]; let winner = null; if (move1 !== move2) { if ((move1 === 'rock' && move2 === 'scissors') || (move1 === 'scissors' && move2 === 'paper') || (move1 === 'paper' && move2 === 'rock')) { winner = p1; } else { winner = p2; } } if (winner) { game.status = `${winner.name} wins! ${game.moves[winner.id]} beats ${game.moves[winner.id === p1.id ? p2.id : p1.id]}.`; endRound(game, winner); } else { game.status = `Draw! Both chose ${move1}.`; endRound(game, null); } } else { game.status = `${game.players.find(p=>p.id === playerId).name} has made a move.`; } }
function handleMemoryMatchMove(game, playerId, index) { if (game.board[index].isFlipped || game.flippedIndices.length >= 2) return; game.board[index].isFlipped = true; game.flippedIndices.push(index); if (game.flippedIndices.length === 2) { const [i1, i2] = game.flippedIndices; if (game.board[i1].value === game.board[i2].value) { game.board[i1].isMatched = true; game.board[i2].isMatched = true; game.playerPoints[playerId]++; game.flippedIndices = []; if (game.board.every(c => c.isMatched)) { const p1Score = game.playerPoints[game.players[0].id]; const p2Score = game.playerPoints[game.players[1].id]; const winner = p1Score > p2Score ? game.players[0] : (p2Score > p1Score ? game.players[1] : null); endRound(game, winner); } } else { setTimeout(() => { game.board[i1].isFlipped = false; game.board[i2].isFlipped = false; game.flippedIndices = []; switchTurn(game); broadcast(game.gameId, { type: 'gameState', game }); }, 1500); } } }

function endRound(game, winner) { game.roundOver = true; if (winner) { game.winnerId = winner.id; game.status = `${winner.name} wins the round!`; game.matchScore[winner.id]++; } else { game.status = "It's a draw!"; } }
function checkMatchOver(game) { const [p1, p2] = game.players; if (p2 && game.matchScore[p1.id] >= WIN_SCORE) { game.gameOver = true; game.status = `${p1.name} wins the match!`; } else if (p2 && game.matchScore[p2.id] >= WIN_SCORE) { game.gameOver = true; game.status = `${p2.name} wins the match!`; } }
function switchTurn(game) { const currentPlayerIndex = game.players.findIndex(p => p.id === game.turn); const nextPlayer = game.players[1 - currentPlayerIndex]; if(nextPlayer) { game.turn = nextPlayer.id; game.status = `It's ${nextPlayer.name}'s turn.`; } }
function checkWin(board, gameType) { if (gameType === 'connect_four') { for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) { if (!board[r][c]) continue; if (c <= 3 && board[r][c] === board[r][c+1] && board[r][c] === board[r][c+2] && board[r][c] === board[r][c+3]) return true; if (r <= 2 && board[r][c] === board[r+1][c] && board[r][c] === board[r+2][c] && board[r][c] === board[r+3][c]) return true; if (r <= 2 && c <= 3 && board[r][c] === board[r+1][c+1] && board[r][c] === board[r+2][c+2] && board[r][c] === board[r+3][c+3]) return true; if (r <= 2 && c >= 3 && board[r][c] === board[r+1][c-1] && board[r][c] === board[r+2][c-2] && board[r][c] === board[r+3][c-3]) return true; } } return false; }

function handleDisconnect(ws) { const gameId = ws.gameId; if (gameId && games[gameId]) { if (games[gameId].players.length <= 2) { broadcast(gameId, { type: 'opponentLeft' }); delete games[gameId]; } } }
function generateId() { return Math.random().toString(36).substring(2, 9); }
function broadcast(gameId, data) { if (!games[gameId]) return; games[gameId].players.forEach(player => { wss.clients.forEach(client => { if (client.id === player.id && client.readyState === WebSocket.OPEN) { client.send(JSON.stringify(data)); } }); }); }
function placeShips() { const board = Array(100).fill(''); const ships = [5, 4, 3, 3, 2]; ships.forEach(size => { let placed = false; while(!placed){ const isHorizontal = Math.random() < 0.5; const start = Math.floor(Math.random() * 100); const row = Math.floor(start / 10); const col = start % 10; if(canPlace(board, size, row, col, isHorizontal)){ for(let i=0; i<size; i++){ board[start + (isHorizontal ? i : i*10)] = 'ship'; } placed = true; } } }); return board; }
function canPlace(board, size, row, col, isHorizontal) { if (isHorizontal) { if (col + size > 10) return false; for (let i = 0; i < size; i++) if (board[row * 10 + col + i]) return false; } else { if (row + size > 10) return false; for (let i = 0; i < size; i++) if (board[(row + i) * 10 + col]) return false; } return true; }
function getShipLocations(board){ return board.map((val, i) => val === 'ship' ? i : -1).filter(i => i !== -1); }
