
const PORT = process.env.PORT || 9601;
const INDEX = "/index.html";

const logger = require("pino")();

const server = require("express")()
    .use((req, res) => res.sendFile(INDEX, { root: __dirname }))
    .listen(PORT, () => l_listen(PORT));

const { Server } = require("ws");
const wss = new Server({ server });

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
        var i = 5 + 1;
        do {
            i--;
            if (i < 0) return false;
            var x = this.board[i][col];
        } while (x != 0)
        this.board[i][col] = client.color;
        return true;
    };
};
class sessionClass {
    constructor(ws, name, color, pass) {
        this.clients = [];
        this.clients.push({socket: ws, name: name, color: color, index: 0 });
        this.gameBoard = new gameBoard();
        this.passcode = pass;
        this.properties = {};
        this.isReady = false;
        this.timer = configTimer(pass);
    }

    ready(ws, name, color) {
        this.clients.push({ socket: ws, name: name, color: color, index: 1 });
        this.properties.playerTurn = this.clients[Math.round(Math.random())];
        this.isReady = true;
    }
    remRet(pass, map) {
        var x = this;
        clearTimeout(this.timer);
        map.delete(pass);
        return x;
    }
    flipTurn() {
        if (this.properties.playerTurn.index == 0) {
            this.properties.playerTurn = this.clients[1];
        } else this.properties.playerTurn = this.clients[0];
    }

};
var pendingMap = new Map();
var ongoingMap = new Map();

wss.on('connection', function connection(ws) {
    l_recConn(ws._socket.remoteAddress);
    ws.on('message', function (message) {
        var data = JSON.parse(message);
        switch (data.type) {
            case "session":
                handleSession(data, ws);
                break;
            case "choice":
                handleChoice(data, ws);
                break;
        }
    });
    ws.on("close", function () {
        var result = isUserInMap(pendingMap, ws);
        if (result) {
            l_cancPend(result.pass);
            clearTimeout(pendingMap.get(result.pass).timer);
            pendingMap.delete(result.pass);
        }
        result = isUserInMap(ongoingMap, ws);
        if (result) {
            l_surr(result.pass, result.client.name);
            endSession(result.pass, "surrender",
                ongoingMap.get(result.pass).clients[(result.client.index == 0) ? 1 : 0].name
            );
        }
    })
});

function handleSession(data, ws) {
    var pass = data.passcode;
    if (pendingMap.has(pass)) {
        var session = pendingMap.get(pass).remRet(pass, pendingMap);
        session.ready(ws, data.name, 2);
        ongoingMap.set(pass, session);
        l_movePend(pass, session.clients[0].name, session.clients[1].name);
        sendSessionDetails(session);
        updateTurnInfo(session);
    }
    else if (ongoingMap.has(pass)) {
        l_inUseSess(pass, data.name);
        ws.send(JSON.stringify({ type: "error", code: 5 }));
    } else {
        pendingMap.set(pass, new sessionClass(ws, data.name, 1, pass));
        l_addPend(pass, pendingMap.get(pass).clients[0].name);
    }
}

function isUserInMap(map, ws) {
    for (const session of map) {
        if (session[1].clients !== undefined) {
            for (const client of session[1].clients) {
                if (ws == client.socket)
                    return { pass: session[1].passcode, client: client };
            }
        }
    }
}

function handleChoice(data, ws) {
    var pass = data.passcode;
    if (!ongoingMap.has(pass) || !ongoingMap.get(pass).isReady) return;
    var session = ongoingMap.get(pass);
    var turn = session.properties.playerTurn;
    if (turn.socket !== ws) {
        ws.send(JSON.stringify({ type: "error", code: 6 }));
        return;
    }
    if (session.gameBoard.dropPiece(data.value, turn) === false) return;
    wss.broadcast(JSON.stringify({ type: "BoardUpdate", board: session.gameBoard.board }), pass);
    l_actUpd(pass, session.clients[0].name, session.clients[1].name);
    var check = session.gameBoard.checkWinConditions(turn.color);
    if (check !== false) {
        l_actOver(pass, turn.name);
        endSession(pass, check, turn.name);
        return;
    }
    updateTurnInfo(session);
}

function configTimer(pass) {
    return setTimeout(function () {
        l_pendExp(pass);
        pendingMap.get(pass).clients[0].socket.send(JSON.stringify({
            type: "info",
            msg: "Session expired create another one!"
        }));
        pendingMap.delete(pass);
    }, 60000);
}

function endSession(pass, reason, winner) {
    wss.broadcast(JSON.stringify({ type: "gameOver", reason: reason, winner: winner }), pass);
    ongoingMap.delete(pass);
}

function sendSessionDetails(session) {
    var info = {
        type: "sessionConfirmation",
        color: null,
        name: null
    };
    for (var index = 0; index < 2; index++) {
        info.color = session.clients[index].color;
        info.name = session.clients[index].name;
        session.clients[index].socket.send(JSON.stringify(info));
    }
}

function updateTurnInfo(session) {
    session.flipTurn();
    var jsonInfo = {
        type: "info",
        code: "i_Turn",
        turnColor: null,
        turnName: null
    };
    for (var index = 0; index < 2; index++) {
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


//logger prints
function l_listen(port) { l_log("Server listening on port " + port) }
function l_recConn(address) { l_log("Received connection from " + address) }
function l_cancPend(pass) { l_log("Session in pending list canceled(passcode: " + pass + ", reason: userDisconnected)") }
function l_surr(pass, name) { l_log("Session surrendered(passcode: " + pass + ", winner: " + name + ")") }
function l_movePend(pass, p0, p1) { l_log("Session moved from waiting list to active list (passcode: " + pass + ", player0 : " + p0 + ", player1 :" + p1 + ")") }
function l_inUseSess(pass, name) { l_log("Session with in-use name was tried to be created (passcode: " + pass + ", player0: " + name + ")") }
function l_addPend(pass, name) { l_log("Session added to the waiting list(passcode: " + pass + ", player0: " + name + ")") }
function l_actUpd(pass, p0, p1) { l_log("Session game update (passcode: " + pass + ", player0: " + p0 + ", player1: " + p1 + ")") }
function l_actOver(pass, name) { l_log("Session terminated (passcode: " + pass + ", winner: " + name + ")") }
function l_pendExp(pass) { l_log("Session expired (passcode: " + pass + ")") }

function l_log(msg) { logger.info(msg); }