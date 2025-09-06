// --- WebSocket Server for Multiplayer Game (for Render) ---

const WebSocket = require('ws');

// Render provides the PORT environment variable.
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// In-memory storage for games. In a real app, you'd use a database.
let games = {};

console.log(`✅ WebSocket server is starting on port ${PORT}...`);

wss.on('listening', () => {
    console.log(`✅ WebSocket server is running and listening on port ${PORT}!`);
});

wss.on('connection', ws => {
    // Assign a unique ID to each player
    ws.id = generateId();
    console.log(`Player ${ws.id} connected.`);

    // Send the new player their unique ID
    try {
        ws.send(JSON.stringify({ type: 'init', playerId: ws.id }));
    } catch (error) {
        console.error("Failed to send init message:", error);
    }


    ws.on('message', message => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            console.error("Invalid JSON received:", message);
            return;
        }

        console.log(`Received message:`, data); // Log every message for debugging

        const { type, gameId, name, gameType, move, message: chatMessage } = data;
        const game = games[gameId];

        switch (type) {
            case 'create':
                const newGameId = generateId();
                games[newGameId] = {
                    gameId: newGameId,
                    gameType: gameType,
                    players: [{ id: ws.id, name: name, score: 0 }],
                    board: gameType === 'tic-tac-toe' ? Array(9).fill(null) : null,
                    turn: null, // Will be set when game starts
                    status: `Waiting for an opponent...`
                };
                ws.gameId = newGameId;
                ws.send(JSON.stringify({ type: 'created', gameId: newGameId }));
                console.log(`Game ${newGameId} created by ${name}.`);
                break;

            case 'join':
                if (game && game.players.length < 2) {
                    game.players.push({ id: ws.id, name: name, score: 0 });
                    ws.gameId = gameId;

                    // Assign symbols for Tic Tac Toe
                    if (game.gameType === 'tic-tac-toe') {
                        game.players[0].symbol = 'X';
                        game.players[1].symbol = 'O';
                        game.turn = game.players[0].id; // Player 1 starts
                        game.status = `It's ${game.players[0].name}'s turn (X).`;
                    } else {
                         game.status = "Make your move!";
                    }

                    // Notify both players that the game has started
                    broadcast(gameId, { type: 'gameState', game });
                    console.log(`${name} joined game ${gameId}. Game starting.`);
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Game not found or is full.' }));
                }
                break;

            case 'move':
                if (!game) return;
                // This is a simplified move handler. A real server would have full game logic.
                console.log(`Move received for game ${gameId}:`, move);
                // For now, we'll just broadcast the updated state.
                // You would add win condition checks and turn management here.
                
                // Example for Tic-Tac-Toe
                if(game.gameType === 'tic-tac-toe' && ws.id === game.turn) {
                    if (game.board[move.cellIndex] === null) {
                        const currentPlayer = game.players.find(p => p.id === ws.id);
                        game.board[move.cellIndex] = currentPlayer.symbol;
                        
                        // Switch turn
                        const nextPlayer = game.players.find(p => p.id !== ws.id);
                        game.turn = nextPlayer.id;
                        game.status = `It's ${nextPlayer.name}'s turn (${nextPlayer.symbol}).`

                        // Here you would check for a winner
                    }
                }
                
                broadcast(gameId, { type: 'gameState', game });
                break;
            
            case 'chat':
                if (!game) return;
                broadcast(gameId, { type: 'chat', name, message: chatMessage }, ws.id);
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Player ${ws.id} disconnected.`);
        const gameId = ws.gameId;
        if (gameId && games[gameId]) {
            // Remove player from game
            games[gameId].players = games[gameId].players.filter(p => p.id !== ws.id);
            // If no players are left, delete the game to save memory
            if (games[gameId].players.length === 0) {
                delete games[gameId];
                console.log(`Game ${gameId} was empty and has been closed.`);
            } else {
                // Notify the remaining player
                console.log(`Notifying remaining player in game ${gameId}.`);
                broadcast(gameId, { type: 'opponentLeft' });
            }
        }
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for player ${ws.id}:`, error);
    });
});

// --- Helper Functions ---

function generateId() {
    // A simple ID generator
    return Math.random().toString(36).substring(2, 9);
}

function broadcast(gameId, data, excludePlayerId = null) {
    const game = games[gameId];
    if (!game) return;

    // Find all connected clients that are part of this game
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.gameId === gameId) {
            if (client.id !== excludePlayerId) {
                client.send(JSON.stringify(data));
            }
        }
    });
  }
