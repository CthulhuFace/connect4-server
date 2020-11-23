var WebSocketServer = require("ws").Server;
const logger = require("pino")();

const port = 9601;

var wss = new WebSocketServer({ port: port });
logger.info("Server listening on port " + port);

class gameBoard {
    board = [
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0]
    ];
    checkWinConditions(player) {
        for (var j = 0; j < (7 - 3); j++) {// horizontalCheck 
            for (var i = 0; i < 6; i++) {
                if (this.board[i][j] == player && this.board[i][j + 1] == player && this.board[i][j + 2] == player && this.board[i][j + 3] == player) {
                    return { type: "horizontal", x: i, y: j };
                }
            }
        }
        for (var i = 0; i < (6 - 3); i++) {// verticalCheck
            for (var j = 0; j < 7; j++) {
                if (this.board[i][j] == player && this.board[i + 1][j] == player && this.board[i + 2][j] == player && this.board[i + 3][j] == player) {
                    return { type: "vertical", x: i, y: j };
                }
            }
        }
        for (var i = 3; i < 6; i++) {// ascendingDiagonalCheck 
            for (var j = 0; j < (7 - 3); j++) {
                if (this.board[i][j] == player && this.board[i - 1][j + 1] == player && this.board[i - 2][j + 2] == player && this.board[i - 3][j + 3] == player)
                    return { type: "ascDiag", x: i, y: j };
            }
        }
        for (var i = 3; i < 6; i++) {// descendingDiagonalCheck
            for (var j = 3; j < 7; j++) {
                if (this.board[i][j] == player && this.board[i - 1][j - 1] == player && this.board[i - 2][j - 2] == player && this.board[i - 3][j - 3] == player)
                    return { type: "descDiag", x: i, y: j };
            }
        }
        return false;
    };
    dropPiece(col, client) {
        var i = 6;
        do {
            i--;
            if (i < 0) return false;
            var x = this.board[i][col];
        } while (x != 0)
        this.board[i][col] = client.color;
        return true;
    };
};

var pendingMap = new Map();
var ongoingMap = new Map();

wss.on('connection', function connection(ws) {
    logger.info("Received connection from " + ws._socket.remoteAddress);
    ws.on('message', function (message) {
        var data = JSON.parse(message);
        var pass = data.passcode;
        switch (data.type) {
            case "session":
                handleSession(pass, data, ws);
                break;
            case "choice":
                handleChoice(pass, data, ws);
                break;
        }
    })
});

function handleSession(pass, data, ws) {
    if (pendingMap.has(pass)) {
        var session = pendingMap.get(pass);
        clearTimeout(pendingMap.get(pass).timer);
        pendingMap.delete(pass);
        session.clients.push({ socket: ws, name: data.name, color: 1, colorName: "yellow" });
        session.properties.playerTurn = session.clients[Math.round(Math.random())];
        ongoingMap.set(pass, session);
        logger.info("Session moved from waiting list to active list (passcode: " + pass + ", player0 : "
            + session.clients[0].name + ", player1 :" + session.clients[1].name + ")");
        updateTurnInfo(session);
    }
    else if (ongoingMap.has(pass)) {
        logger.info("Session with in-use name was tried to be created (passcode: " + pass + ", player0: "
            + data.name + ")");
        ws.send(JSON.stringify({
            type: "error",
            error: "Passcode currently in-use, try another one!"
        }));
    } else {
        var sessionInstance = {
            clients: [{ socket: ws, name: data.name, color: 2, colorName: "red" }],
            gameBoard: new gameBoard(),
            passcode: pass,
            properties: {},
            timer: configTimer(pass)
        };
        pendingMap.set(pass, sessionInstance);
        logger.info("Session added to the waiting list(passcode: " + pass + ", player0: "
            + sessionInstance.clients[0].name + ")");
    }
}


function handleChoice(pass, data, ws) {
    var session = ongoingMap.get(pass);
    if (session.properties.playerTurn.socket !== ws) {
        ws.send(JSON.stringify({
            type: "error",
            errorMsg: "It's not your turn!"
        }));
        return;
    }
    if (session.gameBoard.dropPiece(data.value,
        session.properties.playerTurn) === false) return;

    wss.broadcast(JSON.stringify({
        type: "BoardUpdate",
        board: session.gameBoard.board
    }), pass);

    logger.info("Session game update (passcode: " + pass + ", player0: "
        + session.clients[0].name + ", player1: " + session.clients[1].name + ")");

    if (session.gameBoard.checkWinConditions(session.properties.playerTurn.color) !== false) {
        endSession(pass, session.properties.playerTurn.name);
        return;
    }
    updateTurnInfo(session);
}


function configTimer(pass) {
    return setTimeout(function () {
        logger.info("Session expired (passcode: " + pass + ")");
        pendingMap.get(pass).clients[0].socket.send(JSON.stringify({
            type: "info",
            msg: "Session expired create another one!"
        }));
        pendingMap.delete(pass);
    }, 60000);
}

function endSession(passcode, winner) {
    logger.info("Session terminated (passcode: " + passcode + ", winner: " + winner + ")");
    var response = {
        "type": "gameOver",
        "winner": winner
    }
    wss.broadcast(JSON.stringify(response), passcode);
    ongoingMap.delete(passcode);
}

function updateTurnInfo(session) {
    session.properties.playerTurn = session.clients[(session.properties.playerTurn == session.clients[0]) ? 1 : 0];
    var jsonInfo = {
        type: "info", 
        code:"i_Turn",
        color: null,
        turnColor: null,
        turnName: null
    };
    for (var index = 0; index < 2; index++) {
        jsonInfo.color = session.clients[index].color
        jsonInfo.turnColor = session.properties.playerTurn.color;
        jsonInfo.turnName = session.properties.playerTurn.name;
        session.clients[index].socket.send(JSON.stringify(jsonInfo));
    }
}

wss.broadcast = function broadcast(msg, passcode) {
    ongoingMap.get(passcode).clients.forEach(function each(client) {
        client.socket.send(msg);
    });
};
